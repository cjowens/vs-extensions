"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
const vscode = require("vscode");
const traceSource_1 = require("../tracing/traceSource");
const debuggerHostServiceTypes_1 = require("../workspace/contract/debuggerHostServiceTypes");
const debuggerService_1 = require("../workspace/debuggerService");
const joinDebugManager_1 = require("./joinDebugManager");
const adapterExecutableProvider_1 = require("./adapterExecutableProvider");
const config = require("../config");
const util = require("../util");
const util_1 = require("../util");
const path = require("path");
const session_1 = require("../session");
class ShareDebugManager {
    constructor(rpcClient, hostAdapterService, debugManager) {
        this.rpcClient = rpcClient;
        this.hostAdapterService = hostAdapterService;
        this.debugManager = debugManager;
        this.activeDebugSessions = [];
        this.onDidStartDebugSession = (eventData) => __awaiter(this, void 0, void 0, function* () {
            if (eventData.type === ShareDebugManager.typeSharedDebug) {
                this.trace.info(`Starting shared debug session:${eventData.id} name:${eventData.name}`);
                const debugSession = yield this.toDebugSession(eventData);
                this.activeDebugSessions.push(debugSession);
                if (this.isSharing) {
                    this.notifySharedDebugSession(debugSession, true);
                }
            }
        });
        // Create our trace source
        this.trace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.DebugRpcHost);
        this.onDidStartDebugSessionEvt = vscode.debug.onDidStartDebugSession(this.onDidStartDebugSession, this);
        this.onDidTerminateDebugSessionEvt = vscode.debug.onDidTerminateDebugSession(this.onDidTerminateDebugSession, this);
        // register '*' to intercept all possible types
        vscode.debug.registerDebugConfigurationProvider('*', this);
        // register adapter executable provider
        this.adapterExecutableProvider = new adapterExecutableProvider_1.AdapterExecutableProvider('Microsoft.Cascade.VSCodeHostAdapter');
        vscode.debug.registerDebugConfigurationProvider(ShareDebugManager.typeSharedDebug, this.adapterExecutableProvider);
    }
    setShareState(isSharing) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isSharing !== isSharing) {
                if (isSharing) {
                    // register myself as the IDebuggerHostService contract
                    yield this.registerDebuggerHostService(true);
                    // handle 'getCurrentDebugSessions' method
                    this.rpcClient.addRequestMethod(ShareDebugManager.getDebuggerHostServiceAndName(debuggerService_1.DebuggerHostService.getCurrentDebugSessionsMethodName), (...params) => {
                        return this.activeDebugSessions;
                    });
                }
                else {
                    this.rpcClient.removeRequestMethod(ShareDebugManager.getDebuggerHostServiceAndName(debuggerService_1.DebuggerHostService.getCurrentDebugSessionsMethodName));
                    // un-register myself as the IDebuggerHostService contract
                    yield this.registerDebuggerHostService(false);
                }
                this.isSharing = isSharing;
                // update existing host debug sessions
                for (const item of this.activeDebugSessions) {
                    yield ShareDebugManager.requestShare(item, isSharing);
                }
            }
        });
    }
    static getAdapterProxyConfig(proxyType) {
        return __awaiter(this, void 0, void 0, function* () {
            const debuggerExtensionInfo = ShareDebugManager.findDebuggerExtensionInfo(proxyType);
            if (!debuggerExtensionInfo) {
                throw new Error(`Failed to find debugger extension info for type:${proxyType}`);
            }
            return yield ShareDebugManager.getAdapterProxyConfigInternal(debuggerExtensionInfo);
        });
    }
    static requestShare(debugSessionInfo, isSharing) {
        return __awaiter(this, void 0, void 0, function* () {
            yield debugSessionInfo.vsCodeDebugSession.customRequest('share', { state: isSharing });
        });
    }
    registerDebuggerHostService(add) {
        return __awaiter(this, void 0, void 0, function* () {
            // register myself as the IDebuggerHostService contract
            yield this.rpcClient.sendRequest(this.trace, 'workspace.registerServices', [debuggerService_1.DebuggerHostService.debuggerHostServiceName], add ? 'Add' : 'Remove');
        });
    }
    resolveDebugConfiguration(folder, debugConfiguration, token) {
        return __awaiter(this, void 0, void 0, function* () {
            if (debugConfiguration.type === undefined ||
                ShareDebugManager.typeSharedDebug === debugConfiguration.type ||
                joinDebugManager_1.JoinDebugManager.typeJoinDebug === debugConfiguration.type ||
                config.get(config.Key.excludedDebugTypes).indexOf(debugConfiguration.type) >= 0 ||
                ShareDebugManager.unsupportedDebugTypes.indexOf(debugConfiguration.type) >= 0) {
                // unsupported proxy type
                return debugConfiguration;
            }
            const debuggerExtensionInfo = ShareDebugManager.findDebuggerExtensionInfo(debugConfiguration.type);
            if (!debuggerExtensionInfo) {
                throw new Error(`Failed to find debugger extension info for type:${debugConfiguration.type}`);
            }
            const adapterProxyConfigInternal = yield ShareDebugManager.getAdapterProxyConfigInternal(debuggerExtensionInfo);
            const adapterProxyConfig = {};
            Object.assign(adapterProxyConfig, adapterProxyConfigInternal);
            adapterProxyConfig.configuration = debugConfiguration;
            const folders = vscode.workspace.workspaceFolders;
            let sharedDebugConfiguration = {
                type: ShareDebugManager.typeSharedDebug,
                name: debugConfiguration.name,
                request: debugConfiguration.request,
                pipeName: this.hostAdapterService.pipeName,
                adapterProxy: adapterProxyConfig,
                preLaunchTask: debugConfiguration.preLaunchTask,
                postDebugTask: debugConfiguration.postDebugTask,
                workspaceFolders: folders,
                isSharing: this.isSharing,
                debugServer: config.get(config.Key.debugHostAdapter)
            };
            // Fill additional properties required by the proxy launcher
            adapterProxyConfigInternal.pipeName = this.hostAdapterService.pipeName;
            adapterProxyConfigInternal.type = debugConfiguration.type;
            // pass arguments to our debug host adapter
            this.adapterExecutableProvider.adapterArguments = [
                '--proxyInfoType64', Buffer.from(JSON.stringify(adapterProxyConfigInternal)).toString('base64')
                // uncomment next line if you want to attach a debugger to the PZ debug adapter
                //,'--debug'
            ];
            if (debugConfiguration.debugServer) {
                this.adapterExecutableProvider.adapterArguments.push('--proxyDebugServer', debugConfiguration.debugServer);
            }
            // uncomment next line if a debugger needs to be attached on the debug host adapter
            //this.adapterExecutableProvider.adapterArguments.push('--debug');
            /**
             * Note: next section will attempt to resolve all the parameters passed as '${command:mycommand}'
             * when passing launch configuration back into the adapter.
             */
            const debuggerConfigurationVars = debuggerExtensionInfo.debuggerConfiguration.variables;
            if (debuggerConfigurationVars) {
                for (let key of Object.keys(debugConfiguration)) {
                    let value = debugConfiguration[key];
                    if (typeof value === 'string') {
                        const valueStr = value;
                        if (valueStr.startsWith(ShareDebugManager.commandPrefix) && valueStr.endsWith('}')) {
                            let commandName = valueStr.substr(ShareDebugManager.commandPrefix.length);
                            commandName = commandName.substring(0, commandName.length - 1);
                            const command = debuggerConfigurationVars[commandName];
                            if (command) {
                                const result = yield vscode.commands.executeCommand(command, debugConfiguration);
                                if (!result) {
                                    // abort this resolveDebugConfiguration
                                    return undefined;
                                }
                                else {
                                    // pass this
                                    sharedDebugConfiguration.adapterProxy.configuration[key] = result;
                                }
                            }
                        }
                    }
                }
            }
            if (debugConfiguration.launchBrowser && debugConfiguration.launchBrowser.enabled) {
                this.onDidStartDebugSessionWithBrowser();
            }
            return sharedDebugConfiguration;
        });
    }
    onDidStartDebugSessionWithBrowser() {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State !== session_1.SessionState.Shared || config.get(config.Key.isShareLocalServerHintDisplayed)) {
                return;
            }
            config.save(config.Key.isShareLocalServerHintDisplayed, true);
            const result = yield vscode.window.showInformationMessage('If you want to share your locally running application, use the "Share Server" feature!', { title: 'Learn More' });
            if (result) {
                util_1.ExtensionUtil.openBrowser('https://aka.ms/vsls-docs/vscode/share-local-server');
            }
        });
    }
    onDidTerminateDebugSession(eventData) {
        if (eventData.type === ShareDebugManager.typeSharedDebug) {
            this.trace.info(`Terminate shared debug session:${eventData.id}`);
            let index = this.activeDebugSessions.findIndex((d) => d.sessionId === eventData.id);
            if (index >= 0) {
                const debugSession = this.activeDebugSessions[index];
                this.activeDebugSessions.splice(index, 1);
                if (this.isSharing) {
                    this.notifySharedDebugSession(debugSession, false);
                }
            }
        }
    }
    notifySharedDebugSession(debugSessionInfo, isAdded) {
        return __awaiter(this, void 0, void 0, function* () {
            const debugSessionEventArgs = {
                changeType: isAdded ? debuggerHostServiceTypes_1.DebugSessionChangeType.Add : debuggerHostServiceTypes_1.DebugSessionChangeType.Remove,
                debugSession: debugSessionInfo
            };
            this.rpcClient.sendNotification(this.trace, ShareDebugManager.getDebuggerHostServiceAndName(debuggerService_1.DebuggerHostService.debugSessionChangedEvent), debugSessionEventArgs);
        });
    }
    toDebugSession(vsCodeDebugSession) {
        return __awaiter(this, void 0, void 0, function* () {
            const debugSessionInfo = yield vsCodeDebugSession.customRequest('debugSessionInfo', {});
            return {
                sessionId: vsCodeDebugSession.id,
                name: vsCodeDebugSession.name,
                processId: undefined,
                vsCodeDebugSession: vsCodeDebugSession,
                capabilities: debugSessionInfo.capabilities,
                configurationProperties: debugSessionInfo.configurationProperties
            };
        });
    }
    static getDebuggerHostServiceAndName(name) {
        return debuggerService_1.DebuggerHostService.debuggerHostServiceName + '.' + name;
    }
    /**
     * Return a debugger extension info from all possible extensions
     */
    static findDebuggerExtensionInfo(type) {
        let debuggerConfiguration;
        let debuggerExtension = vscode.extensions.all.find((e) => {
            if (e.packageJSON.contributes && e.packageJSON.contributes.hasOwnProperty('debuggers')) {
                debuggerConfiguration = e.packageJSON.contributes.debuggers.find((d) => d.type === type);
            }
            return debuggerConfiguration;
        });
        if (debuggerExtension && debuggerConfiguration) {
            return {
                extension: debuggerExtension,
                debuggerConfiguration: debuggerConfiguration
            };
        }
        return undefined;
    }
    /**
     * Capture the program and runtime properties to be passed to our host adapter
     */
    static getAdapterProxyConfigInternal(debuggerExtensionInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            let adapterProxyConfig = {};
            const adapterConfiguration = debuggerExtensionInfo.debuggerConfiguration;
            // per platform specific properties 'osx' 'linux', 'windows'
            const adapterConfigurationPerPlatform = adapterConfiguration[util.getPlatformProperty()];
            // pass 'runtime' property
            adapterProxyConfig.runtime = ShareDebugManager.getPlatformProperty(adapterConfiguration, adapterConfigurationPerPlatform, 'runtime');
            // If the debugger supports the adapterExecutableCommand property then use it to resolve the
            // program & arguments to be passed to our adapter
            if (adapterConfiguration.hasOwnProperty('adapterExecutableCommand')) {
                const commandId = adapterConfiguration.adapterExecutableCommand;
                const result = yield vscode.commands.executeCommand(commandId);
                adapterProxyConfig.program = result.command;
                adapterProxyConfig.arguments = result.args;
            }
            else {
                // otherwise look for program property
                const program = ShareDebugManager.getPlatformProperty(adapterConfiguration, adapterConfigurationPerPlatform, 'program');
                if (program) {
                    adapterProxyConfig.program = path.join(debuggerExtensionInfo.extension.extensionPath, program);
                }
            }
            return adapterProxyConfig;
        });
    }
    static getPlatformProperty(adapterConfiguration, adapterConfigurationPerPlatform, propertyName) {
        // start with platform specific if exists
        if (adapterConfigurationPerPlatform && adapterConfigurationPerPlatform.hasOwnProperty(propertyName)) {
            return adapterConfigurationPerPlatform[propertyName];
        }
        // fallback to non-platform configuration
        return adapterConfiguration[propertyName];
    }
    static getLaunchConfigurations() {
        // launch.json configuration
        const launchConfig = vscode.workspace.getConfiguration('launch');
        if (launchConfig) {
            // retrieve configurations values
            const values = launchConfig.get('configurations');
            if (values) {
                return values;
            }
        }
        // fallback
        return [];
    }
}
ShareDebugManager.typeSharedDebug = 'vslsShare';
ShareDebugManager.commandPrefix = '${command:';
ShareDebugManager.unsupportedDebugTypes = ['al', 'extensionHost'];
exports.ShareDebugManager = ShareDebugManager;

//# sourceMappingURL=shareDebugManager.js.map
