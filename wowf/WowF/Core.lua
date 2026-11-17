-- WowF Core: namespace, SavedVariables, slash command dispatch.
-- Feature modules (Price / Dungeon / Quest) register into ns.commands.

local addonName, ns = ...

ns.name = addonName
ns.commands = ns.commands or {}

local PREFIX = "|cff33ff99WowF|r "

function ns.Print(...)
    local parts = {}
    for i = 1, select("#", ...) do
        parts[i] = tostring((select(i, ...)))
    end
    print(PREFIX .. table.concat(parts, " "))
end

-- Resolve a dotted global path such as "C_QuestLog.GetInfo" without erroring.
function ns.Resolve(path)
    local node = _G
    for key in string.gmatch(path, "[^%.]+") do
        if type(node) ~= "table" then
            return nil
        end
        node = node[key]
    end
    return node
end

function ns.IsAddOnLoaded(name)
    if C_AddOns and C_AddOns.IsAddOnLoaded then
        return C_AddOns.IsAddOnLoaded(name) and true or false
    end
    if IsAddOnLoaded then
        return IsAddOnLoaded(name) and true or false
    end
    return false
end

local DB_SCHEMA = 1

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:SetScript("OnEvent", function(self, event, loadedName)
    if loadedName ~= addonName then
        return
    end
    if type(WowFDB) ~= "table" then
        WowFDB = {}
    end
    WowFDB.schema = WowFDB.schema or DB_SCHEMA
    ns.db = WowFDB
    self:UnregisterEvent("ADDON_LOADED")
end)

local function ShowHelp()
    ns.Print("/wowf probe  - Forever client API check (result saved to WowFDB.probe)")
end

SLASH_WOWF1 = "/wowf"
SlashCmdList.WOWF = function(msg)
    local cmd, rest = (msg or ""):match("^%s*(%S*)%s*(.-)%s*$")
    cmd = (cmd or ""):lower()
    local handler = ns.commands[cmd]
    if handler then
        handler(rest)
    else
        ShowHelp()
    end
end
