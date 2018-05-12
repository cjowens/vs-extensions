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
const path = require("path");
const fs = require("fs");
const os = require("os");
const vscode = require("vscode");
const traceSource_1 = require("../tracing/traceSource");
const debuggerHostServiceTypes_1 = require("../workspace/contract/debuggerHostServiceTypes");
const debuggerService_1 = require("../workspace/debuggerService");
const telemetry_1 = require("../telemetry/telemetry");
const config = require("../config");
const debugEvents_1 = require("../workspace/contract/debugEvents");
const adapterExecutableProvider_1 = require("./adapterExecutableProvider");
var JoinDebugSessionOption;
(function (JoinDebugSessionOption) {
    JoinDebugSessionOption["Automatic"] = "Automatic";
    JoinDebugSessionOption["Manual"] = "Manual";
    JoinDebugSessionOption["Prompt"] = "Prompt";
})(JoinDebugSessionOption = exports.JoinDebugSessionOption || (exports.JoinDebugSessionOption = {}));
class JoinDebugManager {
    constructor(rpcClient, workspaceId, hostAdapterService) {
        this.rpcClient = rpcClient;
        this.workspaceId = workspaceId;
        this.hostAdapterService = hostAdapterService;
        this.sharedDebugSessions = [];
        this.activeJoinedDebugSessions = new Map();
        this.activeEventNotifications = new Map();
        this.onDidStartDebugSession = (eventData) => __awaiter(this, void 0, void 0, function* () {
            if (eventData.type === JoinDebugManager.typeJoinDebug) {
                this.trace.info(`Starting joined debug session:${eventData.id} name:${eventData.name}`);
                // store the shared debug session id and the vsCode debug session
                let response = yield eventData.customRequest('debugSessionId');
                let sharedDebugSessionId = response.Id;
                this.activeJoinedDebugSessions.set(sharedDebugSessionId, eventData);
                // add notifications handlers
                const uiDebugEventName = JoinDebugManager.getDebugSessionServiceEventName(sharedDebugSessionId, JoinDebugManager.uiDebugEventName);
                const cookie = this.rpcClient.addNotificationHandler(uiDebugEventName, (...params) => __awaiter(this, void 0, void 0, function* () {
                    yield this.onUIDebugEvent(sharedDebugSessionId, params[0].body);
                }));
                this.activeEventNotifications.set(sharedDebugSessionId, [{ eventName: uiDebugEventName, cookie: cookie }]);
                // Note: if we just receive the event on our joined debug session, it could
                // happen that the shared debug session is already finished
                if (!this.sharedDebugSessions.find((d) => d.sessionId === sharedDebugSessionId)) {
                    this.trace.verbose(`Terminate ${eventData.id} due to removed shared debug session id:${sharedDebugSessionId}`);
                    eventData.customRequest('forceTerminate');
                }
            }
        });
        // Called when a UIDebugEvent is notified from a shared debug session
        this.onUIDebugEvent = (sharedDebugSessionId, e) => __awaiter(this, void 0, void 0, function* () {
            if (e.type === debugEvents_1.UIDebugEventTypes.debugMessage) {
                const debugMessageEvent = e;
                if (debugMessageEvent.MessageType & debugEvents_1.DebugMessageType.MessageBox) {
                    yield vscode.window.showInformationMessage(`The host’s debug session has been paused for the following reason: '${debugMessageEvent.Message}'`);
                }
            }
        });
        this.onDebugSessionChanged = (eventData) => __awaiter(this, void 0, void 0, function* () {
            if (eventData.changeType === debuggerHostServiceTypes_1.DebugSessionChangeType.Add) {
                this.trace.info(`Host debug session started:${eventData.debugSession.sessionId}`);
                this.sharedDebugSessions.push(eventData.debugSession);
                if (this.joinDebugSessionOptionValue === JoinDebugSessionOption.Automatic) {
                    yield this.joinDebugSession(eventData.debugSession);
                }
                else if (this.joinDebugSessionOptionValue === JoinDebugSessionOption.Prompt) {
                    const result = yield vscode.window.showInformationMessage(`The owner has started a collaborative debugging session ('${eventData.debugSession.name}') that you can join`, { title: 'Join session now' });
                    if (result) {
                        if (this.isDebugSessionValid(eventData.debugSession)) {
                            yield this.joinDebugSession(eventData.debugSession);
                        }
                    }
                }
            }
            else if (eventData.changeType === debuggerHostServiceTypes_1.DebugSessionChangeType.Remove) {
                let debugSessionId = eventData.debugSession.sessionId;
                this.trace.info(`Host debug session removed:${debugSessionId}`);
                // track the shared debugged sessions
                let index = this.sharedDebugSessions.findIndex((d) => d.sessionId === debugSessionId);
                if (index >= 0) {
                    this.sharedDebugSessions.splice(index, 1);
                }
                // if we have a joined debug session make sure we terminate it
                if (this.activeJoinedDebugSessions.has(eventData.debugSession.sessionId)) {
                    this.trace.verbose(`Attempt to terminate joined debug session:${eventData.debugSession.sessionId}`);
                    yield this.activeJoinedDebugSessions.get(eventData.debugSession.sessionId).customRequest('forceTerminate');
                }
            }
        });
        // Create our trace source
        this.trace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.DebugRemote);
        // Create DebuggerHostService and start listening to events
        this.debuggerHostService = new debuggerService_1.DebuggerHostService(rpcClient);
        this.debuggerHostService.onDebugSessionChanged(this.onDebugSessionChanged);
        // register 'cascade' to intercept our launch configurations
        vscode.debug.registerDebugConfigurationProvider(JoinDebugManager.typeJoinDebug, this);
        // advise to start/terminate vsCode debug sessions
        this.onDidStartDebugSessionEvt = vscode.debug.onDidStartDebugSession(this.onDidStartDebugSession, this);
        this.onDidTerminateDebugSessionEvt = vscode.debug.onDidTerminateDebugSession(this.onDidTerminateDebugSession, this);
        const joinDebugSessionOptionSetting = config.get(config.Key.joinDebugSessionOption);
        this.joinDebugSessionOptionValue = JoinDebugSessionOption[joinDebugSessionOptionSetting];
        // register adapter executable provider
        this.adapterExecutableProvider = new adapterExecutableProvider_1.AdapterExecutableProvider('Microsoft.Cascade.VSCodeAdapter');
        vscode.debug.registerDebugConfigurationProvider(JoinDebugManager.typeJoinDebug, this.adapterExecutableProvider);
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            let initDebuggingTelemetryEvent = telemetry_1.Instance.startTimedEvent(telemetry_1.TelemetryEventNames.INITIALIZE_DEBUGGING, true);
            this.sharedDebugSessions = yield this.debuggerHostService.getCurrentDebugSessionsAsync();
            initDebuggingTelemetryEvent.addMeasure(telemetry_1.TelemetryPropertyNames.NUM_DEBUGGING_PROCESSES, this.sharedDebugSessions ? this.sharedDebugSessions.length : 0);
            if (this.sharedDebugSessions && this.sharedDebugSessions.length > 0) {
                const launchDebugSessions = this.sharedDebugSessions.slice(0);
                const launchAll = () => __awaiter(this, void 0, void 0, function* () {
                    launchDebugSessions.forEach((item) => __awaiter(this, void 0, void 0, function* () {
                        // check if the debug session is still valid
                        if (this.isDebugSessionValid(item)) {
                            yield this.joinDebugSession(item);
                        }
                    }));
                });
                initDebuggingTelemetryEvent.addProperty(telemetry_1.TelemetryPropertyNames.DEBUG_PROMPT, (this.joinDebugSessionOptionValue === JoinDebugSessionOption.Prompt).toString());
                if (this.joinDebugSessionOptionValue === JoinDebugSessionOption.Automatic) {
                    yield launchAll();
                }
                else if (this.joinDebugSessionOptionValue === JoinDebugSessionOption.Prompt) {
                    const result = yield vscode.window.showInformationMessage('The owner is already in a collaborative debugging session that you can join', { title: 'Join session now' });
                    if (result) {
                        yield launchAll();
                    }
                }
            }
            initDebuggingTelemetryEvent.end(telemetry_1.TelemetryResult.Success);
        });
    }
    dispose() {
        this.onDidStartDebugSessionEvt.dispose();
        this.onDidTerminateDebugSessionEvt.dispose();
        this.debuggerHostService.removeListener(debuggerService_1.DebuggerHostService.debugSessionChangedEvent, this.onDebugSessionChanged);
    }
    /*
    Return the available debug sessions that can be started by looking on the shared debug sessions
    and filter the already joined sessions
    */
    getAvailableDebugSessions() {
        return this.sharedDebugSessions.filter(i => {
            return !this.activeJoinedDebugSessions.has(i.sessionId);
        });
    }
    resolveDebugConfiguration(folder, debugConfiguration, token) {
        // TODO: we still need to pass a local path to the file service created by our adapter
        // but for VSCode it won't be used since we are starting to use the vsls: scheme
        let wsLocalPath = path.join(os.tmpdir(), this.workspaceId);
        if (!fs.existsSync(wsLocalPath)) {
            fs.mkdirSync(wsLocalPath);
        }
        debugConfiguration.localPath = wsLocalPath;
        debugConfiguration.pipeName = this.hostAdapterService.pipeName;
        this.adapterExecutableProvider.adapterArguments = [];
        const capabilities = debugConfiguration.debugSession.capabilities;
        if (capabilities) {
            const json = JSON.stringify(capabilities);
            const encodedCapabilities = Buffer.from(json).toString('base64');
            this.adapterExecutableProvider.adapterArguments.push('--capabilities64', encodedCapabilities);
        }
        return debugConfiguration;
    }
    joinDebugSession(debugSession) {
        return __awaiter(this, void 0, void 0, function* () {
            const folders = vscode.workspace.workspaceFolders;
            yield vscode.debug.startDebugging(folders ? folders[0] : undefined, JoinDebugManager.toDebugConfiguration(debugSession));
        });
    }
    isDebugSessionValid(debugSession) {
        return this.sharedDebugSessions.find((d) => d.sessionId === debugSession.sessionId) !== undefined;
    }
    static toDebugConfiguration(debugSession) {
        const name = path.parse(debugSession.name).base;
        return {
            type: JoinDebugManager.typeJoinDebug,
            request: 'attach',
            name: name,
            debugSession: debugSession,
            debugServer: config.get(config.Key.debugAdapter)
        };
    }
    onDidTerminateDebugSession(eventData) {
        if (eventData.type === JoinDebugManager.typeJoinDebug) {
            this.trace.info(`Terminate joined debug session:${eventData.id}`);
            for (let [key, value] of this.activeJoinedDebugSessions) {
                if (value.id === eventData.id) {
                    // remove notification handlers
                    this.activeEventNotifications.get(key).forEach(item => {
                        this.rpcClient.removeNotificationHandler(item.eventName, item.cookie);
                    });
                    this.activeEventNotifications.delete(key);
                    this.activeJoinedDebugSessions.delete(key);
                    break;
                }
            }
        }
    }
    // Return the service name being published by the host for an active debug session
    static getDebugSessionServiceEventName(debugSessionId, eventName) {
        return JoinDebugManager.debugSessionHostServiceName + '-' + debugSessionId + '.' + eventName;
    }
}
JoinDebugManager.typeJoinDebug = 'vslsJoin';
JoinDebugManager.debugSessionHostServiceName = 'DebugSessionHostService';
JoinDebugManager.debugEventName = 'debugEvent';
JoinDebugManager.uiDebugEventName = 'uIDebugEvent';
exports.JoinDebugManager = JoinDebugManager;

//# sourceMappingURL=joinDebugManager.js.map
