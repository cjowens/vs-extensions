//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const url = require("url");
const ic = require("./internalConfig");
var Key;
(function (Key) {
    // PUBLIC SETTINGS
    Key[Key["features"] = 0] = "features";
    Key[Key["diagnosticLogging"] = 1] = "diagnosticLogging";
    Key[Key["accountProvider"] = 2] = "accountProvider";
    Key[Key["account"] = 3] = "account";
    Key[Key["connectionMode"] = 4] = "connectionMode";
    Key[Key["joinDebugSessionOption"] = 5] = "joinDebugSessionOption";
    Key[Key["nameTagVisibility"] = 6] = "nameTagVisibility";
    Key[Key["guestApprovalRequired"] = 7] = "guestApprovalRequired";
    Key[Key["excludedDebugTypes"] = 8] = "excludedDebugTypes";
    // PRIVATE SETTINGS
    Key[Key["joinWorkspaceLocalPath"] = 9] = "joinWorkspaceLocalPath";
    Key[Key["agentUri"] = 10] = "agentUri";
    Key[Key["serviceUri"] = 11] = "serviceUri";
    Key[Key["joinInNewWindow"] = 12] = "joinInNewWindow";
    Key[Key["registrationUri"] = 13] = "registrationUri";
    Key[Key["showLauncherInstallNotification"] = 14] = "showLauncherInstallNotification";
    Key[Key["showLauncherError"] = 15] = "showLauncherError";
    Key[Key["joinEventCorrelationId"] = 16] = "joinEventCorrelationId";
    Key[Key["workspaceReloadTime"] = 17] = "workspaceReloadTime";
    Key[Key["userSettingsPath"] = 18] = "userSettingsPath";
    Key[Key["name"] = 19] = "name";
    Key[Key["shortName"] = 20] = "shortName";
    Key[Key["abbreviation"] = 21] = "abbreviation";
    Key[Key["licenseUrl"] = 22] = "licenseUrl";
    Key[Key["privacyUrl"] = 23] = "privacyUrl";
    Key[Key["configName"] = 24] = "configName";
    Key[Key["authority"] = 25] = "authority";
    Key[Key["scheme"] = 26] = "scheme";
    Key[Key["agent"] = 27] = "agent";
    Key[Key["commandPrefix"] = 28] = "commandPrefix";
    Key[Key["launcherName"] = 29] = "launcherName";
    Key[Key["userEmail"] = 30] = "userEmail";
    Key[Key["isInternal"] = 31] = "isInternal";
    Key[Key["canCollectPII"] = 32] = "canCollectPII";
    Key[Key["teamStatus"] = 33] = "teamStatus";
    Key[Key["isShareLocalServerHintDisplayed"] = 34] = "isShareLocalServerHintDisplayed";
    Key[Key["debugAdapters"] = 35] = "debugAdapters";
    Key[Key["sessionCount"] = 36] = "sessionCount";
    Key[Key["requestFeedback"] = 37] = "requestFeedback";
    Key[Key["gitHubUri"] = 38] = "gitHubUri";
    Key[Key["experimentalFeatures"] = 39] = "experimentalFeatures";
    Key[Key["sharedTerminalWindow"] = 40] = "sharedTerminalWindow";
    Key[Key["sharedTerminalWidth"] = 41] = "sharedTerminalWidth";
    Key[Key["sharedTerminalHeight"] = 42] = "sharedTerminalHeight";
    Key[Key["shareDebugTerminal"] = 43] = "shareDebugTerminal";
    Key[Key["debugAdapter"] = 44] = "debugAdapter";
    Key[Key["debugHostAdapter"] = 45] = "debugHostAdapter";
})(Key = exports.Key || (exports.Key = {}));
const privateSettings = [
    Key.joinWorkspaceLocalPath,
    Key.agentUri,
    Key.serviceUri,
    Key.joinInNewWindow,
    Key.registrationUri,
    Key.showLauncherInstallNotification,
    Key.showLauncherError,
    Key.joinEventCorrelationId,
    Key.workspaceReloadTime,
    Key.userSettingsPath,
    Key.name,
    Key.shortName,
    Key.abbreviation,
    Key.licenseUrl,
    Key.privacyUrl,
    Key.configName,
    Key.authority,
    Key.scheme,
    Key.agent,
    Key.commandPrefix,
    Key.launcherName,
    Key.userEmail,
    Key.isInternal,
    Key.canCollectPII,
    Key.teamStatus,
    Key.isShareLocalServerHintDisplayed,
    Key.debugAdapters,
    Key.sessionCount,
    Key.requestFeedback,
    Key.gitHubUri,
    Key.debugAdapter,
    Key.debugHostAdapter,
    Key.experimentalFeatures
];
var FeatureSet;
(function (FeatureSet) {
    FeatureSet["defaultFeatures"] = "default";
    FeatureSet["stable"] = "stable";
    FeatureSet["experimental"] = "experimental";
})(FeatureSet || (FeatureSet = {}));
exports.featureFlags = {
    lsp: true,
    multiGuestLsp: true,
    lspForCSTS: true,
    anyCodePortable: true,
    API: false,
    sharedTerminals: true,
    localUndo: true,
    localRedo: false,
    workspaceTask: false,
    summonParticipants: true,
    guestApproval: true,
    newFileProvider: false,
    shareDebugTerminal: false,
    verticalScrolling: true,
};
const experimentalFeatures = {
    lsp: true,
    multiGuestLsp: true,
    lspForCSTS: true,
    anyCodePortable: true,
    API: true,
    sharedTerminals: true,
    localUndo: true,
    localRedo: true,
    workspaceTask: true,
    summonParticipants: true,
    guestApproval: true,
    newFileProvider: false,
    shareDebugTerminal: true,
    verticalScrolling: true,
};
function isPrivateKey(key) {
    return privateSettings.indexOf(key) >= 0;
}
function initAsync(context) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ic.InternalConfig.initAsync(context, Key[Key.userSettingsPath]);
        let featureSet = FeatureSet[get(Key.features)];
        if (featureSet === FeatureSet.experimental ||
            (((featureSet === FeatureSet.defaultFeatures) || (typeof featureSet === 'undefined')) && get(Key.isInternal))) {
            Object.assign(exports.featureFlags, experimentalFeatures);
        }
        Object.assign(exports.featureFlags, get(Key.experimentalFeatures));
    });
}
exports.initAsync = initAsync;
function save(key, value, global = true, delaySaveToDisk = false) {
    if (isPrivateKey(key)) {
        return ic.InternalConfig.save(Key[key], value, delaySaveToDisk);
    }
    let extensionConfig = vscode.workspace.getConfiguration(get(Key.configName));
    if (global && value === undefined &&
        extensionConfig.inspect(Key[key]).globalValue === undefined) {
        // Trying to remove a global value that doesn't exist throws an exception.
        return;
    }
    return extensionConfig.update(Key[key], value, global);
}
exports.save = save;
function get(key) {
    if (isPrivateKey(key)) {
        return ic.InternalConfig.get(Key[key]);
    }
    let extensionConfig = vscode.workspace.getConfiguration(get(Key.configName));
    let value = extensionConfig.get(Key[key]);
    return value;
}
exports.get = get;
function getUri(key) {
    if (isPrivateKey(key)) {
        return ic.InternalConfig.getUri(Key[key]);
    }
    let value = get(key);
    if (!value) {
        return null;
    }
    try {
        return url.parse(value);
    }
    catch (e) {
        return null;
    }
}
exports.getUri = getUri;

//# sourceMappingURL=config.js.map
