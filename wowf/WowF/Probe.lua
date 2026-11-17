-- WowF Probe (Phase 0)
-- Verifies the Forever-client assumptions the design depends on.
-- Read-only: it never calls throttled APIs (ReplicateItems) or protected actions.

local _, ns = ...

-- expect = true  : design needs this API to exist
-- expect = false : legacy Classic API that should be gone on the Midnight-based client
local API_CHECKS = {
    { "C_QuestLog.GetNumQuestLogEntries", true },
    { "C_QuestLog.GetInfo", true },
    { "C_QuestLog.GetTitleForQuestID", true },
    { "C_QuestLog.IsQuestFlaggedCompleted", true },
    { "GetQuestLogTitle", false },

    { "C_Item.GetItemInfo", true },
    { "C_Item.GetItemInfoInstant", true },
    { "C_Item.RequestLoadItemDataByID", true },
    { "GetItemInfo", false },
    { "TooltipDataProcessor.AddTooltipPostCall", true },

    { "C_AuctionHouse.ReplicateItems", true },
    { "C_AuctionHouse.GetNumReplicateItems", true },
    { "C_AuctionHouse.GetReplicateItemInfo", true },
    { "C_AuctionHouse.SendBrowseQuery", true },
    { "C_AuctionHouse.SupportsCopperValues", true },
    { "QueryAuctionItems", false },

    { "GetInstanceInfo", true },
    { "GetLootSlotLink", true },
    { "EJ_GetNumTiers", true },

    { "C_Map.GetBestMapForUnit", true },
    { "C_Map.SetUserWaypoint", true },

    { "issecretvalue", true },
    { "C_ChatInfo.SendAddonMessage", true },
    { "CombatLogGetCurrentEventInfo", false },
}

-- Other addons WowF may use as data providers.
local PROVIDER_ADDONS = {
    "Questie",
    "QuestieDB",
    "Auctionator",
    "AtlasLootClassic",
    "AtlasLoot",
    "Atlas",
}

local function SafeCall(fn, ...)
    if type(fn) ~= "function" then
        return nil
    end
    local ok, a, b, c, d = pcall(fn, ...)
    if not ok then
        return nil, a
    end
    return a, b, c, d
end

local function RunProbe()
    local result = {
        time = time(),
        apis = {},
        mismatches = {},
        providers = {},
    }

    local version, build, buildDate, interface = GetBuildInfo()
    result.build = {
        version = version,
        build = build,
        date = buildDate,
        interface = interface,
    }
    result.projectId = WOW_PROJECT_ID
    result.projectCamelot = WOW_PROJECT_CAMELOT
    result.locale = GetLocale()
    result.realm = GetRealmName()
    result.faction = UnitFactionGroup("player")

    for _, check in ipairs(API_CHECKS) do
        local path, expected = check[1], check[2]
        local present = type(ns.Resolve(path)) == "function"
        result.apis[path] = present
        if present ~= expected then
            table.insert(result.mismatches, path)
        end
    end

    -- Encounter Journal: community reports say tiers = 0 on Forever (no client-side loot data).
    result.ejTiers = SafeCall(_G.EJ_GetNumTiers)

    if C_AuctionHouse then
        result.copperValues = SafeCall(C_AuctionHouse.SupportsCopperValues)
    end

    for _, name in ipairs(PROVIDER_ADDONS) do
        result.providers[name] = ns.IsAddOnLoaded(name)
    end

    if ns.db then
        ns.db.probe = result
    end
    return result
end

local function Report(result)
    local b = result.build
    ns.Print(("build %s (%s) interface=%s"):format(tostring(b.version), tostring(b.build), tostring(b.interface)))
    ns.Print(("WOW_PROJECT_ID=%s CAMELOT=%s locale=%s"):format(
        tostring(result.projectId), tostring(result.projectCamelot), tostring(result.locale)))

    local isForever = type(b.interface) == "number" and b.interface >= 16000 and b.interface < 20000
    ns.Print(isForever and "Forever 클라이언트 확인" or "|cffff5555Forever 클라이언트가 아닌 것 같음|r")

    ns.Print(("EJ_GetNumTiers=%s  (0/nil이면 던전 데이터는 자체 DB 필요)"):format(tostring(result.ejTiers)))

    if #result.mismatches == 0 then
        ns.Print(("API %d개 모두 예상대로"):format(#API_CHECKS))
    else
        ns.Print(("|cffffcc00예상과 다른 API %d개:|r"):format(#result.mismatches))
        for _, path in ipairs(result.mismatches) do
            ns.Print("  " .. path .. " = " .. (result.apis[path] and "있음" or "없음"))
        end
    end

    local loaded = {}
    for _, name in ipairs(PROVIDER_ADDONS) do
        if result.providers[name] then
            table.insert(loaded, name)
        end
    end
    ns.Print("연동 가능 애드온: " .. (#loaded > 0 and table.concat(loaded, ", ") or "없음"))
    ns.Print("전체 결과: /reload 후 WTF\\Account\\<계정>\\SavedVariables\\WowF.lua")
end

ns.commands.probe = function()
    Report(RunProbe())
end

ns.RunProbe = RunProbe
