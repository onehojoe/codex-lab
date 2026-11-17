<#
.SYNOPSIS
    WowF 설치·업데이트 도구 (WoW Forever 애드온, Windows 전용)

.DESCRIPTION
    1. WoW 설치 폴더를 자동으로 찾습니다 (_forever_ 폴더가 있는 곳).
    2. GitHub의 WowF 버전과 설치된 버전을 비교해, 다르면 기존 WowF 폴더를 지우고 새로 설치합니다.
    3. -Install 을 주면 윈도우 로그인 때마다 자동으로 업데이트하도록 시작프로그램에 등록하고,
       바탕화면에 수동 업데이트 바로가기를 만듭니다.
    애드온 설정·데이터(WTF\...\SavedVariables\WowF.lua)는 건드리지 않습니다.

.EXAMPLE
    .\WowF-Updater.ps1 -Install          최초 설치 + 자동 업데이트 등록
.EXAMPLE
    .\WowF-Updater.ps1                   업데이트 확인, 버전이 바뀌었으면 재설치
.EXAMPLE
    .\WowF-Updater.ps1 -CheckOnly        경로와 버전만 확인 (아무것도 바꾸지 않음)
.EXAMPLE
    .\WowF-Updater.ps1 -WowPath "D:\Games\World of Warcraft" -Install
.EXAMPLE
    .\WowF-Updater.ps1 -Uninstall        WowF 애드온, 자동 업데이트, 바로가기 제거
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$CheckOnly,
    [switch]$Force,
    [switch]$Silent,
    [switch]$Pause,
    [switch]$NoAutoUpdate,
    [string]$WowPath,
    [string]$Branch,
    [string]$SourceZip
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Windows PowerShell 5.1 다운로드 진행바는 매우 느림

$Repo          = 'onehojoe/codex-lab'
$DefaultBranch = 'main'
$AddonName     = 'WowF'
$AddonRelPath  = 'wowf/WowF'
$UpdaterRel    = 'wowf/installer/WowF-Updater.ps1'

if ($env:OS -ne 'Windows_NT') {
    Write-Host 'WowF 설치 도구는 Windows 전용입니다.'
    exit 1
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$AppDir        = Join-Path $env:LOCALAPPDATA 'WowF'
$AppScript     = Join-Path $AppDir 'WowF-Updater.ps1'
$ConfigFile    = Join-Path $AppDir 'config.json'
$LogFile       = Join-Path $AppDir 'update.log'
$StartupLink   = Join-Path ([Environment]::GetFolderPath('Startup')) 'WowF 자동 업데이트.lnk'
$DesktopLink   = Join-Path ([Environment]::GetFolderPath('Desktop')) 'WowF 업데이트.lnk'
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path -LiteralPath $AppDir)) {
    New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
}

#region 로그 / 설정

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Level, $Message
    try {
        if ((Test-Path -LiteralPath $LogFile) -and ((Get-Item -LiteralPath $LogFile).Length -gt 512KB)) {
            Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.old') -Force
        }
        [IO.File]::AppendAllText($LogFile, $line + "`r`n", (New-Object Text.UTF8Encoding $false))
    } catch { }
    if (-not $Silent) {
        $color = 'Gray'
        if ($Level -eq 'WARN') { $color = 'Yellow' }
        elseif ($Level -eq 'ERROR') { $color = 'Red' }
        elseif ($Level -eq 'OK') { $color = 'Green' }
        Write-Host $Message -ForegroundColor $color
    }
}

function Read-Config {
    $cfg = @{ WowRoot = $null; Branch = $DefaultBranch; InstalledVersion = $null; LastCheck = $null }
    if (Test-Path -LiteralPath $ConfigFile) {
        try {
            $json = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($p in $json.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
        } catch {
            Write-Log 'config.json 을 읽지 못해 새로 만듭니다.' 'WARN'
        }
    }
    return $cfg
}

function Save-Config {
    param([hashtable]$Cfg)
    $text = New-Object PSObject -Property $Cfg | ConvertTo-Json
    [IO.File]::WriteAllText($ConfigFile, $text, (New-Object Text.UTF8Encoding $false))
}

#endregion

#region WoW 설치 위치 찾기

# "…\World of Warcraft\_forever_\Interface\AddOns", "…\_retail_\Wow.exe" 같은 경로를 WoW 루트로 바꾼다.
function ConvertTo-WowRoot {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    $p = $Path.Trim().Trim('"').Trim()
    # Split-Path 은 없는 드라이브면 예외를 내므로 문자열만 다루는 IO.Path 를 쓴다.
    if ($p -match '\.exe$') { $p = [IO.Path]::GetDirectoryName($p) }
    if (-not $p) { return $null }
    if ($p -match '^(.+?)[\\/]_(retail|classic|forever|ptr|beta|xptr)[a-z_]*_(?:[\\/].*)?$') { $p = $Matches[1] }
    $p = $p.TrimEnd([char[]]@('\', '/'))
    if ($p -match '^[A-Za-z]:$') { $p += '\' }   # "C:" 는 현재 폴더 기준이 되므로 "C:\" 로
    return $p
}

function Test-WowRoot {
    param([string]$Root)
    if ([string]::IsNullOrWhiteSpace($Root)) { return $false }
    # Join-Path 는 없는 드라이브(빠진 외장 디스크 등)면 예외를 내므로 IO.Path 를 쓴다.
    return (Test-Path -LiteralPath ([IO.Path]::Combine($Root, '_forever_')) -PathType Container)
}

function Get-FixedDrives {
    [IO.DriveInfo]::GetDrives() |
        Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } |
        ForEach-Object { $_.RootDirectory.FullName }
}

function Get-WowRootCandidates {
    $list = New-Object System.Collections.Generic.List[string]

    # 1) Blizzard 레지스트리
    $blizzKeys = @(
        'HKLM:\SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft',
        'HKLM:\SOFTWARE\Blizzard Entertainment\World of Warcraft',
        'HKCU:\SOFTWARE\Blizzard Entertainment\World of Warcraft'
    )
    foreach ($k in $blizzKeys) {
        try {
            $item = Get-ItemProperty -LiteralPath $k -ErrorAction SilentlyContinue
            if ($item) {
                foreach ($name in @('InstallPath', 'GamePath')) {
                    if ($item.PSObject.Properties[$name]) { $list.Add([string]$item.$name) }
                }
            }
        } catch { }
    }

    # 2) 프로그램 제거 목록
    $uninstallKeys = @(
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($k in $uninstallKeys) {
        try {
            Get-ItemProperty -Path $k -ErrorAction SilentlyContinue | ForEach-Object {
                $dn = $_.PSObject.Properties['DisplayName']
                $il = $_.PSObject.Properties['InstallLocation']
                if ($dn -and $il -and ([string]$dn.Value -match 'World of Warcraft|월드 오브 워크래프트|Forever|포에버')) {
                    $list.Add([string]$il.Value)
                }
            }
        } catch { }
    }

    # 3) Battle.net 기본 설치 경로
    try {
        $bnetCfg = [IO.Path]::Combine($env:APPDATA, 'Battle.net\Battle.net.config')
        if (Test-Path -LiteralPath $bnetCfg) {
            $raw = Get-Content -LiteralPath $bnetCfg -Raw -ErrorAction SilentlyContinue
            if ($raw) {
                foreach ($m in [regex]::Matches($raw, '"DefaultInstallPath"\s*:\s*"([^"]+)"')) {
                    $base = ($m.Groups[1].Value -replace '\\\\', '\') -replace '/', '\'
                    $list.Add([IO.Path]::Combine($base, 'World of Warcraft'))
                }
            }
        }
    } catch { }

    # 4) 흔한 설치 위치 (모든 고정 드라이브)
    $relative = @(
        'World of Warcraft',
        'Program Files (x86)\World of Warcraft',
        'Program Files\World of Warcraft',
        'Games\World of Warcraft',
        'Game\World of Warcraft',
        'Blizzard\World of Warcraft',
        'Blizzard Games\World of Warcraft',
        'Battle.net\World of Warcraft'
    )
    foreach ($d in (Get-FixedDrives)) {
        foreach ($r in $relative) { $list.Add([IO.Path]::Combine($d, $r)) }
    }

    return $list
}

function Find-WowRoot {
    $seen = @{}
    foreach ($candidate in (Get-WowRootCandidates)) {
        $root = ConvertTo-WowRoot $candidate
        if (-not $root) { continue }
        $key = $root.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        if (Test-WowRoot $root) { return $root }
    }

    # 5) 마지막 수단: 고정 드라이브를 3단계 깊이까지 검색
    Write-Log '알려진 위치에 없어서 드라이브를 검색합니다. 잠시 걸릴 수 있습니다...' 'WARN'
    foreach ($d in (Get-FixedDrives)) {
        $hit = Get-ChildItem -LiteralPath $d -Directory -Filter '_forever_' -Depth 3 -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($hit) { return $hit.Parent.FullName }
    }
    return $null
}

#endregion

#region 버전

function Get-TocVersion {
    param([string]$Text)
    if ($Text -and $Text -match '(?m)^##\s*Version:\s*(\S+)') { return $Matches[1] }
    return $null
}

function Get-InstalledVersion {
    param([string]$AddonsDir)
    $toc = Join-Path (Join-Path $AddonsDir $AddonName) "$AddonName.toc"
    if (-not (Test-Path -LiteralPath $toc)) { return $null }
    return Get-TocVersion (Get-Content -LiteralPath $toc -Raw -Encoding UTF8)
}

function Get-RemoteVersion {
    param([string]$BranchName)
    $url = 'https://raw.githubusercontent.com/{0}/{1}/{2}/{3}.toc?nocache={4}' -f $Repo, $BranchName, $AddonRelPath, $AddonName, [DateTime]::UtcNow.Ticks
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    $content = $resp.Content
    if ($content -is [byte[]]) { $content = [Text.Encoding]::UTF8.GetString($content) }
    $version = Get-TocVersion $content
    if (-not $version) { throw "버전 정보를 읽지 못했습니다: $url" }
    return $version
}

# 앞에 있는 브랜치부터 시도해서 처음 성공한 것을 쓴다.
function Resolve-Remote {
    param([string[]]$Branches)
    $lastError = $null
    foreach ($b in $Branches) {
        try {
            return @{ Branch = $b; Version = (Get-RemoteVersion $b) }
        } catch {
            $lastError = $_
        }
    }
    throw ("GitHub에서 WowF 버전을 읽지 못했습니다 (브랜치: {0}). 인터넷 연결을 확인하세요. 상세: {1}" -f ($Branches -join ', '), $lastError.Exception.Message)
}

#endregion

#region 설치 / 제거

# WowF 폴더가 아닌 곳은 절대 지우지 않도록 막는다.
function Assert-AddonPath {
    param([string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $parent = Split-Path -Parent $full
    $leaf = Split-Path -Leaf $full
    if (($parent -notmatch '[\\/]_forever_[\\/]Interface[\\/]AddOns$') -or ($leaf -notmatch '^WowF(\.__(new|old))?$')) {
        throw "안전 검사 실패: WowF 폴더가 아닌 경로는 지우지 않습니다 ($full)"
    }
    return $full
}

function Remove-AddonDir {
    param([string]$Path)
    $full = Assert-AddonPath $Path
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}

function Install-Addon {
    param([string]$AddonsDir, [string]$BranchName)
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('WowF-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $zip = Join-Path $tmp 'src.zip'
        if ($SourceZip) {
            Copy-Item -LiteralPath $SourceZip -Destination $zip
        } else {
            $url = 'https://github.com/{0}/archive/refs/heads/{1}.zip' -f $Repo, $BranchName
            Write-Log "다운로드: $url"
            Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
        }

        $extract = Join-Path $tmp 'x'
        Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force

        $toc = Get-ChildItem -LiteralPath $extract -Recurse -File -Filter "$AddonName.toc" |
            Where-Object { $_.Directory.Name -eq $AddonName -and $_.Directory.Parent.Name -eq 'wowf' } |
            Select-Object -First 1
        if (-not $toc) { throw "받은 파일 안에 $AddonRelPath/$AddonName.toc 가 없습니다." }
        $srcDir = $toc.Directory.FullName
        $newVersion = Get-TocVersion (Get-Content -LiteralPath $toc.FullName -Raw -Encoding UTF8)

        # 새 폴더를 옆에 먼저 만들고, 이름만 바꿔 끼운다. 실패하면 기존 폴더를 되돌린다.
        $target  = Join-Path $AddonsDir $AddonName
        $staging = Join-Path $AddonsDir "$AddonName.__new"
        $backup  = Join-Path $AddonsDir "$AddonName.__old"
        Remove-AddonDir $staging
        Remove-AddonDir $backup

        Copy-Item -LiteralPath $srcDir -Destination $staging -Recurse
        if (Test-Path -LiteralPath $target) {
            Assert-AddonPath $target | Out-Null
            Rename-Item -LiteralPath $target -NewName "$AddonName.__old"
        }
        try {
            Rename-Item -LiteralPath $staging -NewName $AddonName
        } catch {
            if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $target)) {
                Rename-Item -LiteralPath $backup -NewName $AddonName
            }
            throw
        }
        Remove-AddonDir $backup

        # 설치 도구 자신도 같은 커밋의 것으로 갱신
        $newUpdater = Join-Path $toc.Directory.Parent.FullName 'installer\WowF-Updater.ps1'
        if (Test-Path -LiteralPath $newUpdater) {
            Copy-Item -LiteralPath $newUpdater -Destination $AppScript -Force
        }

        return $newVersion
    } finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Install-UpdaterCopy {
    param([string]$BranchName)
    $self = $PSCommandPath
    if ($self -and (Test-Path -LiteralPath $self) -and ([IO.Path]::GetFullPath($self) -ne [IO.Path]::GetFullPath($AppScript))) {
        Copy-Item -LiteralPath $self -Destination $AppScript -Force
    } elseif (-not (Test-Path -LiteralPath $AppScript)) {
        $url = 'https://raw.githubusercontent.com/{0}/{1}/{2}' -f $Repo, $BranchName, $UpdaterRel
        Invoke-WebRequest -Uri $url -OutFile $AppScript -UseBasicParsing -TimeoutSec 60
    }
}

function New-Shortcut {
    param([string]$LinkPath, [string]$Arguments, [int]$WindowStyle, [string]$Description)
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($LinkPath)
    $lnk.TargetPath = $PowerShellExe
    $lnk.Arguments = $Arguments
    $lnk.WorkingDirectory = $AppDir
    $lnk.WindowStyle = $WindowStyle
    $lnk.Description = $Description
    $lnk.Save()
}

function Test-WowRunning {
    param([string]$Root)
    $prefix = $Root.TrimEnd('\') + '\'
    foreach ($proc in (Get-Process -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $proc.Path } catch { }
        if ($path -and $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function Show-QuestieStatus {
    param([string]$AddonsDir)
    $names = @(Get-ChildItem -LiteralPath $AddonsDir -Directory -Filter 'Questie*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    if ($names.Count -eq 0) {
        Write-Log 'Questie 가 없습니다. CurseForge 앱에서 World of Warcraft > Forever 를 고르고 Questie 를 설치하세요 (무료).' 'WARN'
    } else {
        Write-Log ('Questie 확인: ' + ($names -join ', ')) 'OK'
    }
}

function Invoke-Uninstall {
    param([string]$AddonsDir)
    if ($AddonsDir) {
        foreach ($n in @($AddonName, "$AddonName.__new", "$AddonName.__old")) {
            Remove-AddonDir (Join-Path $AddonsDir $n)
        }
        Write-Log ('애드온 삭제: ' + (Join-Path $AddonsDir $AddonName)) 'OK'
    } else {
        Write-Log 'WoW 위치를 못 찾아 애드온 폴더는 건너뜁니다.' 'WARN'
    }
    foreach ($l in @($StartupLink, $DesktopLink)) {
        if (Test-Path -LiteralPath $l) { Remove-Item -LiteralPath $l -Force }
    }
    Write-Log '자동 업데이트와 바로가기를 지웠습니다. 애드온 데이터(WTF 폴더의 WowF.lua)는 남겨 두었습니다.' 'OK'
    # 바로가기의 작업 폴더가 AppDir 이라 그대로면 폴더가 사용 중으로 남는다.
    Set-Location -LiteralPath ([IO.Path]::GetTempPath())
    [Environment]::CurrentDirectory = [IO.Path]::GetTempPath()
    Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction SilentlyContinue
}

#endregion

#region 실행

$exitCode = 0
try {
    $cfg = Read-Config

    # 1) WoW 위치
    $root = $null
    if ($WowPath) {
        $root = ConvertTo-WowRoot $WowPath
        if (-not (Test-WowRoot $root)) { throw "지정한 경로에 _forever_ 폴더가 없습니다: $WowPath" }
    } elseif ($cfg['WowRoot'] -and (Test-WowRoot ([string]$cfg['WowRoot']))) {
        $root = [string]$cfg['WowRoot']
    } else {
        $root = Find-WowRoot
    }
    $addonsDir = $null
    if ($root) { $addonsDir = Join-Path $root '_forever_\Interface\AddOns' }

    if ($Uninstall) {
        Invoke-Uninstall $addonsDir
        return
    }

    if (-not $root) {
        throw 'WoW Forever 설치 폴더를 찾지 못했습니다. Battle.net 에서 Forever 를 한 번 실행한 뒤 다시 하거나, -WowPath "D:\Games\World of Warcraft" 처럼 직접 지정하세요.'
    }
    $cfg['WowRoot'] = $root
    Write-Log "WoW 위치: $root"

    # 2) 버전 비교
    $installed = Get-InstalledVersion $addonsDir
    if ($SourceZip) {
        $remote = @{ Branch = [string]$cfg['Branch']; Version = '(로컬 zip)' }
    } else {
        # -Branch 를 주면 그 브랜치만, 아니면 main 을 먼저 보고 없으면 저장된 브랜치를 본다.
        if ($Branch) {
            $branches = @($Branch)
        } else {
            $branches = @($DefaultBranch)
            if ($cfg['Branch'] -and ([string]$cfg['Branch'] -ne $DefaultBranch)) { $branches += [string]$cfg['Branch'] }
        }
        # 윈도우 로그인 직후에는 인터넷이 늦게 붙을 수 있어서 자동 실행 때만 재시도한다.
        $attempts = 1
        if ($Silent) { $attempts = 3 }
        $remote = $null
        for ($i = 1; $i -le $attempts; $i++) {
            try {
                $remote = Resolve-Remote $branches
                break
            } catch {
                if ($i -ge $attempts) { throw }
                Write-Log "인터넷 연결을 기다렸다가 다시 시도합니다 ($i/$attempts)" 'WARN'
                Start-Sleep -Seconds 30
            }
        }
        $cfg['Branch'] = $remote['Branch']
    }

    $installedLabel = '없음'
    if ($installed) { $installedLabel = $installed }
    Write-Log ('설치된 버전: {0} / GitHub 버전: {1} ({2})' -f $installedLabel, $remote['Version'], $remote['Branch'])
    $needsUpdate = $Force -or [bool]$SourceZip -or (-not $installed) -or ($installed -ne $remote['Version'])

    if ($CheckOnly) {
        if ($needsUpdate) { Write-Log '업데이트가 필요합니다. (-CheckOnly 라서 바꾸지 않았습니다)' 'WARN' }
        else { Write-Log '최신 버전입니다.' 'OK' }
        Show-QuestieStatus $addonsDir
        return
    }

    # 3) 설치 도구를 고정 위치로 복사 (애드온 설치 때 zip 안의 최신본으로 다시 덮어씀)
    if ($Install) { Install-UpdaterCopy $cfg['Branch'] }

    # 4) 버전이 다르면 지우고 재설치
    if ($needsUpdate) {
        if (-not (Test-Path -LiteralPath $addonsDir)) { New-Item -ItemType Directory -Path $addonsDir -Force | Out-Null }
        if (Test-WowRunning $root) { Write-Log '게임이 켜져 있습니다. 설치가 끝나면 게임에서 /reload 하세요.' 'WARN' }
        $newVersion = Install-Addon $addonsDir $cfg['Branch']
        $cfg['InstalledVersion'] = $newVersion
        Write-Log ('WowF {0} 설치 완료: {1}' -f $newVersion, (Join-Path $addonsDir $AddonName)) 'OK'
    } else {
        Write-Log '최신 버전입니다.' 'OK'
    }

    # 5) 자동 업데이트와 바로가기
    if ($Install) {
        New-Shortcut -LinkPath $DesktopLink `
            -Arguments ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Pause' -f $AppScript) `
            -WindowStyle 1 -Description 'WowF 업데이트 확인'
        Write-Log "바탕화면에 'WowF 업데이트' 바로가기를 만들었습니다." 'OK'
        if ($NoAutoUpdate) {
            if (Test-Path -LiteralPath $StartupLink) { Remove-Item -LiteralPath $StartupLink -Force }
        } else {
            New-Shortcut -LinkPath $StartupLink `
                -Arguments ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Silent' -f $AppScript) `
                -WindowStyle 7 -Description 'WowF 자동 업데이트 (윈도우 로그인 시)'
            Write-Log '윈도우 로그인 때마다 자동으로 업데이트하도록 등록했습니다.' 'OK'
        }
    }

    Show-QuestieStatus $addonsDir
    $cfg['LastCheck'] = (Get-Date).ToString('s')
    Save-Config $cfg
}
catch {
    $msg = $_.Exception.Message
    if (($_.Exception -is [UnauthorizedAccessException]) -or ($msg -match 'denied|거부')) {
        $msg += ' (권한 문제입니다. PowerShell 을 관리자 권한으로 실행해 다시 해 보세요.)'
    }
    Write-Log "오류: $msg" 'ERROR'
    $exitCode = 1
}
finally {
    if ($Pause -and -not $Silent) { [void](Read-Host '엔터를 누르면 창이 닫힙니다') }
}
exit $exitCode

#endregion
