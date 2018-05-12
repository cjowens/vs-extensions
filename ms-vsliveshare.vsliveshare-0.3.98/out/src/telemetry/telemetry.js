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
const vscode_extension_telemetry_1 = require("vscode-extension-telemetry");
const path = require("path");
const vscode_jsonrpc_1 = require("vscode-jsonrpc");
const util_1 = require("../util");
const traceSource_1 = require("../tracing/traceSource");
const config = require("../config");
class Telemetry {
    constructor() {
        let packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const { name, version, aiKey } = require(packageJsonPath);
        this.reporter = new vscode_extension_telemetry_1.default(name, version, aiKey);
        this.contextProperties = {};
        this.collaborating = false;
    }
    static get Instance() {
        if (!Telemetry.singleton) {
            Telemetry.singleton = new Telemetry();
        }
        return Telemetry.singleton;
    }
    addContextProperty(property, value, isPII = false) {
        // no need to set `undefined` values
        if (value === undefined) {
            return;
        }
        const valueString = String(value);
        if (isPII && !config.get(config.Key.canCollectPII)) {
            this.contextProperties[property] = traceSource_1.Privacy.getShortHash(valueString);
        }
        else {
            this.contextProperties[property] = valueString;
        }
    }
    removeContextProperty(property) {
        delete this.contextProperties[property];
    }
    addContextPropertiesToObject(properties) {
        return Object.assign({}, this.contextProperties, properties);
    }
    sendTelemetryEvent(eventName, properties, measures) {
        this.reporter.sendTelemetryEvent(eventName, this.addContextPropertiesToObject(properties), measures);
    }
    sendFault(eventName, type, details, exception, correlatedEvent) {
        (new Fault(eventName, type, details, exception, correlatedEvent)).send();
    }
    sendShareFault(type, details, exception, correlatedEvent) {
        this.sendFault(TelemetryEventNames.SHARE_FAULT, type, details, exception, correlatedEvent);
    }
    sendJoinFault(type, details, exception, correlatedEvent) {
        this.sendFault(TelemetryEventNames.JOIN_FAULT, type, details, exception, correlatedEvent);
    }
    sendSignInFault(type, details, exception, correlatedEvent) {
        this.sendFault(TelemetryEventNames.SIGN_IN_FAULT, type, details, exception, correlatedEvent);
    }
    sendActivateExtensionFault(type, details, exception, correlatedEvent) {
        this.sendFault(TelemetryEventNames.ACTIVATE_EXTENSION_FAULT, type, details, exception, correlatedEvent);
    }
    sendDeactivateExtensionFault(type, details, exception, correlatedEvent) {
        this.sendFault(TelemetryEventNames.DEACTIVATE_EXTENSION_FAULT, type, details, exception, correlatedEvent);
    }
    sendActivateAgentAsyncFault(type, details, exception, correlatedEvent) {
        this.sendFault(TelemetryEventNames.ACTIVATE_AGENTASYNC_FAULT, type, details, exception, correlatedEvent);
    }
    sendTransition(currentState, nextState, fromAction) {
        let transitionTelemetryEvent = new TelemetryEvent(TelemetryEventNames.TRANSITION);
        transitionTelemetryEvent.addProperty(TelemetryPropertyNames.CURRENT_STATE, currentState);
        transitionTelemetryEvent.addProperty(TelemetryPropertyNames.NEXT_STATE, nextState);
        transitionTelemetryEvent.addProperty(TelemetryPropertyNames.TRANSITION_ACTION, fromAction);
        transitionTelemetryEvent.send();
    }
    versionCheckFail(platformName, platformVersion, versionInfoServicePack) {
        let versionCheckFailFault = new Fault(TelemetryEventNames.VERSION_CHECK_FAIL, FaultType.User, 'Version check failed.');
        versionCheckFailFault.addProperty(TelemetryPropertyNames.VERSION_PLATFORMNAME, platformName);
        versionCheckFailFault.addProperty(TelemetryPropertyNames.VERSION_PLATFORMVERSION, platformVersion);
        versionCheckFailFault.addProperty(TelemetryPropertyNames.VERSION_PLATFORMVERSION_SERVICEPACK, String(versionInfoServicePack));
        versionCheckFailFault.send();
    }
    startSession(isHost) {
        this.addContextProperty(TelemetryPropertyNames.IS_HOST, isHost);
        this.sendTelemetryEvent(TelemetryEventNames.SESSION_START);
    }
    endSession(guestsByIDE, distinctGuestsByIDE) {
        TelemetryEvent.create(TelemetryEventNames.SESSION_END, {
            properties: {
                guestsByIDE: JSON.stringify(guestsByIDE),
                distinctGuestsByIDE: JSON.stringify(distinctGuestsByIDE)
            }
        }).send();
        this.removeContextProperty(TelemetryPropertyNames.IS_HOST);
    }
    startTimedEvent(eventName, correlate = false) {
        return new TimedEvent(eventName, correlate);
    }
    setUserInfo(userInfo) {
        if (!(userInfo && userInfo.emailAddress)) {
            return;
        }
        if (userInfo.emailAddress !== config.get(config.Key.userEmail)) {
            config.save(config.Key.userEmail, userInfo.emailAddress);
        }
        if (userInfo.emailAddress.endsWith('microsoft.com') && !config.get(config.Key.isInternal)) {
            config.save(config.Key.isInternal, true);
            this.addContextProperty(TelemetryPropertyNames.IS_INTERNAL, 'true');
        }
    }
    setServiceEndpoint(serviceEndpoint) {
        this.addContextProperty(TelemetryPropertyNames.SERVICE_ENDPOINT, serviceEndpoint);
    }
    setSettingsContextProperties() {
        this.addContextProperty(TelemetryPropertyNames.IS_INTERNAL, config.get(config.Key.isInternal) ? 'true' : 'false');
        this.addContextProperty(TelemetryPropertyNames.USER_TEAM_STATUS, config.get(config.Key.teamStatus));
        this.addContextProperty(TelemetryPropertyNames.CONNECTION_MODE, config.get(config.Key.connectionMode));
        this.addContextProperty(TelemetryPropertyNames.FEATURE_FLAGS, JSON.stringify(config.featureFlags));
    }
    setCorrelationEvent(correlationEvent) {
        this.correlationEvent = correlationEvent;
    }
    removeCorrelationEvent(correlationEvent) {
        if (this.correlationEvent === correlationEvent) {
            this.correlationEvent = undefined;
        }
    }
    correlate(telemetryEvent) {
        if (this.correlationEvent) {
            telemetryEvent.correlateWith(this.correlationEvent);
        }
    }
    httpRequestComplete(requestUri, requestUriMask, requestMethod, responseStatusCode, responseReasonPhrase, clientTiming, serverTimingDiagnostics, serverDependencyDiagnostics, correlationId, hadException, exceptionMessage) {
        let httpRequestCompleteEvent = new TelemetryEvent(TelemetryEventNames.HTTP_REQUEST_COMPLETE);
        this.correlate(httpRequestCompleteEvent);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_REQUEST_URI_MASK, requestUriMask);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_REQUEST_METHOD, requestMethod);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_REQUEST_STATUS_CODE, responseStatusCode);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_REQUEST_REASON_PHRASE, responseReasonPhrase);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_CLIENT_TIMING, clientTiming);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_SERVER_TIMING_DIAGNOSTICS, serverTimingDiagnostics);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_HAD_EXCEPTION, hadException);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_EXCEPTION_MESSAGE, exceptionMessage);
        httpRequestCompleteEvent.addProperty(TelemetryPropertyNames.HTTP_CORRELATION_ID, correlationId);
        httpRequestCompleteEvent.send();
    }
    genericOperation(eventName, result, payload) {
        let genericOperationEvent = new TelemetryEvent(eventName);
        this.correlate(genericOperationEvent);
        genericOperationEvent.addProperty(TelemetryPropertyNames.EVENT_RESULT, this.capitalizeFirstChar(result));
        for (let key in payload) {
            if (payload.hasOwnProperty(key)) {
                const value = payload[key] === undefined
                    || payload[key] === null ? undefined : payload[key].toString();
                genericOperationEvent.addProperty(TelemetryPropertyNames.FEATURE_NAME + this.capitalizeFirstChar(key), value);
            }
        }
        genericOperationEvent.send();
    }
    capitalizeFirstChar(content) {
        return content.charAt(0).toUpperCase() + content.slice(1);
    }
}
const Instance = Telemetry.Instance;
exports.Instance = Instance;
class TelemetryEvent {
    constructor(eventName, correlate = false) {
        this.eventName = eventName;
        this.properties = {};
        this.measures = {};
        this.correlationId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        if (correlate) {
            Instance.correlate(this);
        }
    }
    static create(property, data) {
        const correlate = data ? !!data.correlate : false;
        const telemetryEvent = new TelemetryEvent(property, correlate);
        if (data.properties) {
            Object.keys(data.properties)
                .forEach(key => telemetryEvent.addProperty(TelemetryPropertyNames.FEATURE_NAME + key, data.properties[key]));
        }
        if (data.measures) {
            Object.keys(data.measures)
                .forEach(key => telemetryEvent.addMeasure(TelemetryPropertyNames.FEATURE_NAME + key, data.measures[key]));
        }
        return telemetryEvent;
    }
    addProperty(property, value, isPII = false) {
        // no need to set `undefined` values
        if (value === undefined) {
            return;
        }
        const valueString = String(value);
        if (isPII && !config.get(config.Key.canCollectPII)) {
            this.properties[property] = traceSource_1.Privacy.getShortHash(valueString);
        }
        else {
            this.properties[property] = valueString;
        }
    }
    propertyExists(property) {
        return property in this.properties;
    }
    addMeasure(measure, value) {
        this.measures[measure] = value;
    }
    getCorrelationId() {
        return this.correlationId;
    }
    correlateWith(otherEvent) {
        this.correlationId = otherEvent.getCorrelationId();
    }
    correlateWithId(correlationId) {
        this.correlationId = correlationId;
    }
    send() {
        return __awaiter(this, void 0, void 0, function* () {
            this.addMeasure(TelemetryPropertyNames.CORRELATION_ID, this.correlationId);
            Instance.sendTelemetryEvent(this.eventName, this.properties, this.measures);
        });
    }
}
exports.TelemetryEvent = TelemetryEvent;
function removeEmailAddresses(str) {
    return str.replace(/[\S]+@[\S]+/gi, '[EMAIL]');
}
function cleanSensitiveInformation(str) {
    return str ? removeEmailAddresses(util_1.PathUtil.removePath(str, '[PATH]/')) : str;
}
exports.cleanSensitiveInformation = cleanSensitiveInformation;
class Fault extends TelemetryEvent {
    constructor(eventName, type, details, exception, correlatedEvent) {
        super(eventName);
        this.addProperty(TelemetryPropertyNames.FAULT_TYPE, FaultType[type]);
        if (details) {
            this.addProperty(TelemetryPropertyNames.EVENT_MESSAGE, cleanSensitiveInformation(details));
        }
        let exceptionStack = '';
        if (exception && exception instanceof vscode_jsonrpc_1.ResponseError) {
            if (exception.code && typeof exception.code === 'number') {
                this.addMeasure(TelemetryPropertyNames.EVENT_EXCEPTION_CODE, exception.code);
            }
            if (exception.data && typeof exception.data === 'string') {
                // RPC response errors have the remote stack trace in the data property.
                exceptionStack += util_1.PathUtil.removePath(exception.data) +
                    '\n   --- End of remote exception stack trace ---\n';
            }
        }
        if (exception && exception.stack && typeof exception.stack === 'string') {
            exceptionStack += util_1.PathUtil.removePath(exception.stack);
        }
        if (!exceptionStack) {
            exceptionStack = 'No Stack';
        }
        this.addProperty(TelemetryPropertyNames.EVENT_EXCEPTION_STACK, exceptionStack);
        if (correlatedEvent) {
            this.correlateWith(correlatedEvent);
        }
    }
    attachClientLog(numLines) {
        return __awaiter(this, void 0, void 0, function* () {
            if (numLines > 0) {
                try {
                    let lastClientLogLines = yield util_1.ExtensionUtil.readLastNLinesFromFile(util_1.ExtensionUtil.getClientLogFilePath(), numLines);
                    this.addProperty(TelemetryPropertyNames.CLIENT_LOG_LINES, cleanSensitiveInformation(lastClientLogLines));
                }
                catch (_a) { }
            }
        });
    }
    attachAgentLog(numLines) {
        return __awaiter(this, void 0, void 0, function* () {
            if (numLines > 0) {
                try {
                    let lastAgentLogLines = yield util_1.ExtensionUtil.readLastNLinesFromFile(util_1.ExtensionUtil.agentLogFilePath, numLines);
                    this.addProperty(TelemetryPropertyNames.AGENT_LOG_LINES, cleanSensitiveInformation(lastAgentLogLines));
                }
                catch (_a) { }
            }
        });
    }
    send(clientLines = 10, agentLines = 10) {
        const _super = name => super[name];
        return __awaiter(this, void 0, void 0, function* () {
            yield this.attachClientLog(clientLines);
            yield this.attachAgentLog(agentLines);
            return _super("send").call(this);
        });
    }
}
exports.Fault = Fault;
class TimedEvent extends TelemetryEvent {
    constructor(eventName, correlate = false) {
        super(eventName, correlate);
        this.startTime = (new Date()).getTime();
        this.lastMarkTime = this.startTime;
        TimedEvent.scopeStack.push(this);
    }
    markTime(markName, fromStart = false) {
        let currentTime = (new Date()).getTime();
        let duration = fromStart ? (currentTime - this.startTime) : (currentTime - this.lastMarkTime);
        this.lastMarkTime = currentTime;
        this.addMeasure(markName, duration);
    }
    end(result, message, sendNow = true) {
        this.addProperty(TelemetryPropertyNames.EVENT_RESULT, TelemetryResult[result]);
        if (message) {
            this.addProperty(TelemetryPropertyNames.EVENT_MESSAGE, util_1.PathUtil.removePath(message));
        }
        this.markTime(TelemetryPropertyNames.EVENT_DURATION, true);
        Instance.removeCorrelationEvent(this);
        if (sendNow) {
            this.send();
        }
        for (let i = TimedEvent.scopeStack.length - 1; i >= 0; i--) {
            if (TimedEvent.scopeStack[i] === this) {
                TimedEvent.scopeStack.splice(i, 1);
            }
        }
    }
    static propagateOffsetMarkTime(markName, markEvent) {
        for (let i = 0; i < TimedEvent.scopeStack.length; i++) {
            const targetEvent = TimedEvent.scopeStack[i];
            if (targetEvent !== markEvent) {
                targetEvent.markTime(markName);
            }
        }
    }
}
TimedEvent.scopeStack = [];
exports.TimedEvent = TimedEvent;
var FaultType;
(function (FaultType) {
    FaultType[FaultType["Error"] = 0] = "Error";
    FaultType[FaultType["User"] = 1] = "User";
    FaultType[FaultType["Unknown"] = 2] = "Unknown";
    FaultType[FaultType["NonBlockingFault"] = 3] = "NonBlockingFault";
})(FaultType = exports.FaultType || (exports.FaultType = {}));
var TelemetryResult;
(function (TelemetryResult) {
    TelemetryResult[TelemetryResult["Cancel"] = 0] = "Cancel";
    TelemetryResult[TelemetryResult["Success"] = 1] = "Success";
    TelemetryResult[TelemetryResult["Failure"] = 2] = "Failure";
    TelemetryResult[TelemetryResult["UserFailure"] = 3] = "UserFailure";
    TelemetryResult[TelemetryResult["IndeterminateFailure"] = 4] = "IndeterminateFailure";
})(TelemetryResult = exports.TelemetryResult || (exports.TelemetryResult = {}));
class TelemetryEventNames {
}
TelemetryEventNames.FAULT_PREFIX = 'Fault/';
TelemetryEventNames.ACTIVATE_EXTENSION = 'activate-extension';
TelemetryEventNames.DEACTIVATE_EXTENSION = 'deactivate-extension';
TelemetryEventNames.ACTIVATE_AGENTASYNC = 'activate-agentasync';
TelemetryEventNames.JOIN_ON_START_EVENT = 'join-on-start';
TelemetryEventNames.START_AGENT = 'start-agent';
TelemetryEventNames.START_AGENT_CONNECTION = 'start-agentconnection';
TelemetryEventNames.SIGN_IN = 'signin-user';
TelemetryEventNames.JOIN_WORKSPACE = 'join-workspace';
TelemetryEventNames.SHARE_WORKSPACE = 'share-workspace';
TelemetryEventNames.WORKSPACE_RELOAD = 'reload-workspace';
TelemetryEventNames.HTTP_REQUEST_COMPLETE = 'complete-httprequest';
TelemetryEventNames.SESSION_START = 'start-session';
TelemetryEventNames.SESSION_END = 'end-session';
TelemetryEventNames.INITIALIZE_DEBUGGING = 'initialize-debugging';
TelemetryEventNames.INITIALIZE_COAUTHORING = 'initialize-coauthoring';
TelemetryEventNames.VERSION_CHECK_FAIL = TelemetryEventNames.FAULT_PREFIX + 'check-version-fault';
TelemetryEventNames.SIGN_IN_FAULT = TelemetryEventNames.FAULT_PREFIX + 'signin-user-fault';
TelemetryEventNames.UPDATE_WORKPSACE_NAME_FAIL = TelemetryEventNames.FAULT_PREFIX + 'update-workspace-name-fault';
TelemetryEventNames.SHARE_FAULT = TelemetryEventNames.FAULT_PREFIX + 'share-workspace-fault';
TelemetryEventNames.JOIN_FAULT = TelemetryEventNames.FAULT_PREFIX + 'join-workspace-fault';
TelemetryEventNames.ACTIVATE_EXTENSION_FAULT = TelemetryEventNames.FAULT_PREFIX + 'activate-extension-fault';
TelemetryEventNames.DEACTIVATE_EXTENSION_FAULT = TelemetryEventNames.FAULT_PREFIX + 'deactivate-extension-fault';
TelemetryEventNames.ACTIVATE_AGENTASYNC_FAULT = TelemetryEventNames.FAULT_PREFIX + 'activate-agentasync-fault';
TelemetryEventNames.UNHANDLED_COMMAND_ERROR_FAULT = TelemetryEventNames.FAULT_PREFIX + 'unhandled-commanderror-fault';
TelemetryEventNames.UNHANDLED_REJECTION_FAULT = TelemetryEventNames.FAULT_PREFIX + 'unhandled-rejection-fault';
TelemetryEventNames.TRANSITION = 'transition-state';
TelemetryEventNames.REPORT_AGENTPROGRESS = 'report-agentprogress';
TelemetryEventNames.WRITE_LOGS_FAILED = TelemetryEventNames.FAULT_PREFIX + 'write-logs-failed';
TelemetryEventNames.OPEN_LOGS_FAILED = TelemetryEventNames.FAULT_PREFIX + 'open-logs-failed';
TelemetryEventNames.NAME_LOGS_FILE_FAILED = TelemetryEventNames.FAULT_PREFIX + 'name-logfile-failed';
TelemetryEventNames.FEEDBACK = 'report-feedback';
TelemetryEventNames.LINUX_VERSION = 'report-linuxversion';
exports.TelemetryEventNames = TelemetryEventNames;
class TelemetryPropertyNames {
}
TelemetryPropertyNames.FEATURE_NAME = 'liveshare.';
TelemetryPropertyNames.AGENT_START_AGENT_FOUND = TelemetryPropertyNames.FEATURE_NAME + 'AgentFound';
TelemetryPropertyNames.AGENT_SPAWN_START_TIME = TelemetryPropertyNames.FEATURE_NAME + 'AgentSpawnStartTime';
TelemetryPropertyNames.AGENT_SPAWN_END_TIME = TelemetryPropertyNames.FEATURE_NAME + 'AgentSpawnEndTime';
TelemetryPropertyNames.CORRELATION_ID = TelemetryPropertyNames.FEATURE_NAME + 'CorrelationId';
TelemetryPropertyNames.EVENT_RESULT = TelemetryPropertyNames.FEATURE_NAME + 'Result';
TelemetryPropertyNames.EVENT_MESSAGE = TelemetryPropertyNames.FEATURE_NAME + 'Message';
TelemetryPropertyNames.EVENT_EXCEPTION_STACK = TelemetryPropertyNames.FEATURE_NAME + 'ExceptionStack';
TelemetryPropertyNames.EVENT_EXCEPTION_CODE = TelemetryPropertyNames.FEATURE_NAME + 'ExceptionCode';
TelemetryPropertyNames.EVENT_DURATION = TelemetryPropertyNames.FEATURE_NAME + 'Duration';
TelemetryPropertyNames.IS_DEBUGGING = TelemetryPropertyNames.FEATURE_NAME + 'IsDebugging';
TelemetryPropertyNames.SILENT_SIGN_IN = TelemetryPropertyNames.FEATURE_NAME + 'SilentSignIn';
TelemetryPropertyNames.SIGN_IN_WITH_CODE = TelemetryPropertyNames.FEATURE_NAME + 'WithCode';
TelemetryPropertyNames.SIGN_IN_WITH_BROWSER = TelemetryPropertyNames.FEATURE_NAME + 'BrowserSignIn';
TelemetryPropertyNames.JOIN_WITH_LINK = TelemetryPropertyNames.FEATURE_NAME + 'WithLink';
TelemetryPropertyNames.SIGN_IN_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'SignInComplete';
TelemetryPropertyNames.SHARE_WORKSPACE_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'ShareWorkspaceComplete';
TelemetryPropertyNames.GET_WORKSPACE_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'GetWorkspaceComplete';
TelemetryPropertyNames.INIT_COEDITING_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'InitCoeditingComplete';
TelemetryPropertyNames.INIT_DEBUGGING_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'InitDebuggingComplete';
TelemetryPropertyNames.HTTP_REQUEST_URI_MASK = TelemetryPropertyNames.FEATURE_NAME + 'RequestUriMask';
TelemetryPropertyNames.HTTP_REQUEST_METHOD = TelemetryPropertyNames.FEATURE_NAME + 'RequestMethod';
TelemetryPropertyNames.HTTP_REQUEST_STATUS_CODE = TelemetryPropertyNames.FEATURE_NAME + 'ResponseStatusCode';
TelemetryPropertyNames.HTTP_REQUEST_REASON_PHRASE = TelemetryPropertyNames.FEATURE_NAME + 'ResponseReasonPhrase';
TelemetryPropertyNames.HTTP_CLIENT_TIMING = TelemetryPropertyNames.FEATURE_NAME + 'ClientTiming';
TelemetryPropertyNames.HTTP_SERVER_TIMING_DIAGNOSTICS = TelemetryPropertyNames.FEATURE_NAME + 'ServerTimingDiagnostics';
TelemetryPropertyNames.HTTP_CORRELATION_ID = TelemetryPropertyNames.FEATURE_NAME + 'CorrelationId';
TelemetryPropertyNames.HTTP_HAD_EXCEPTION = TelemetryPropertyNames.FEATURE_NAME + 'HadException';
TelemetryPropertyNames.HTTP_EXCEPTION_MESSAGE = TelemetryPropertyNames.FEATURE_NAME + 'ExceptionMessage';
TelemetryPropertyNames.REJECTED_BY_HOST = TelemetryPropertyNames.FEATURE_NAME + 'RejectedByHost';
TelemetryPropertyNames.JOIN_REQUEST_TIMED_OUT = TelemetryPropertyNames.FEATURE_NAME + 'JoinRequestTimedOut';
TelemetryPropertyNames.WORKSPACE_NOT_FOUND = TelemetryPropertyNames.FEATURE_NAME + 'WorkspaceNotFound';
TelemetryPropertyNames.RELOAD_START_TIME = TelemetryPropertyNames.FEATURE_NAME + 'ReloadStartTime';
TelemetryPropertyNames.RELOAD_RESUMED_TIME = TelemetryPropertyNames.FEATURE_NAME + 'ReloadResumedTime';
TelemetryPropertyNames.RELOAD_END_TIME = TelemetryPropertyNames.FEATURE_NAME + 'ReloadEndTime';
TelemetryPropertyNames.JOIN_WORKSPACE_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'JoinWorkspaceComplete';
TelemetryPropertyNames.SERVICE_ENDPOINT = TelemetryPropertyNames.FEATURE_NAME + 'ServiceEndpoint';
TelemetryPropertyNames.IS_HOST = TelemetryPropertyNames.FEATURE_NAME + 'IsHost';
TelemetryPropertyNames.VERSION_PLATFORMNAME = TelemetryPropertyNames.FEATURE_NAME + 'Version.PlatformName';
TelemetryPropertyNames.VERSION_PLATFORMVERSION = TelemetryPropertyNames.FEATURE_NAME + 'Version.PlatformVersion';
TelemetryPropertyNames.VERSION_PLATFORMVERSION_SERVICEPACK = TelemetryPropertyNames.FEATURE_NAME + 'Version.PlatformVersion.ServicePack';
TelemetryPropertyNames.FAULT_TYPE = TelemetryPropertyNames.FEATURE_NAME + 'FaultType';
TelemetryPropertyNames.ENVIRONMENT_VECTOR = TelemetryPropertyNames.FEATURE_NAME + 'EnvironmentVector';
TelemetryPropertyNames.CURRENT_STATE = TelemetryPropertyNames.FEATURE_NAME + 'CurrentState';
TelemetryPropertyNames.NEXT_STATE = TelemetryPropertyNames.FEATURE_NAME + 'NextState';
TelemetryPropertyNames.TRANSITION_ACTION = TelemetryPropertyNames.FEATURE_NAME + 'TransitionAction';
TelemetryPropertyNames.EXTENSION_ACTIVATION_INITIAL_INIT_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'ExtensionActivationInitialInitComplete';
TelemetryPropertyNames.EXTENSION_ACTIVATION_COMPAT_CHECK_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'ExtensionActivationCompatCheckComplete';
TelemetryPropertyNames.EXTENSION_ACTIVATION_LAUNCHER_SETUP_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'ExtensionActivationLauncherSetupComplete';
TelemetryPropertyNames.EXTENSION_ACTIVATION_AGENT_PROCESS_SETUP_COMPLETE = TelemetryPropertyNames.FEATURE_NAME + 'ExtensionActivationAgentProcessSetupComplete';
TelemetryPropertyNames.EXTENSION_ACTIVATION_POST_JOIN = TelemetryPropertyNames.FEATURE_NAME + 'ActivatedPostJoin';
TelemetryPropertyNames.EXTENSION_ACTIVATTED_FROM_PROTOCOL_HANDLER = TelemetryPropertyNames.FEATURE_NAME + 'ActivatedFromProtocolHandler';
TelemetryPropertyNames.JOIN_DEBUG_SESSION_OPTION = TelemetryPropertyNames.FEATURE_NAME + 'JoinDebugSessionOption';
TelemetryPropertyNames.NAME_TAG_VISIBILITY = TelemetryPropertyNames.FEATURE_NAME + 'NameTagVisibility';
TelemetryPropertyNames.NUM_DEBUGGING_PROCESSES = TelemetryPropertyNames.FEATURE_NAME + 'NumDebuggingProcesses';
TelemetryPropertyNames.DEBUG_PROMPT = TelemetryPropertyNames.FEATURE_NAME + 'DebugPrompt';
TelemetryPropertyNames.NUM_OPEN_FILES = TelemetryPropertyNames.FEATURE_NAME + 'NumOpenFiles';
TelemetryPropertyNames.IS_INTERNAL = TelemetryPropertyNames.FEATURE_NAME + 'IsInternal';
TelemetryPropertyNames.USER_TEAM_STATUS = TelemetryPropertyNames.FEATURE_NAME + 'UserTeamStatus';
TelemetryPropertyNames.CONNECTION_MODE = TelemetryPropertyNames.FEATURE_NAME + 'ConnectionMode';
TelemetryPropertyNames.PROGRESS_DURATION = TelemetryPropertyNames.FEATURE_NAME + 'ProgressDuration';
TelemetryPropertyNames.AGENT_START_INITAL_DATA = TelemetryPropertyNames.FEATURE_NAME + 'InitialData';
TelemetryPropertyNames.AGENT_START_RESOLVED_STATE = TelemetryPropertyNames.FEATURE_NAME + 'ResolvedState';
TelemetryPropertyNames.AGENT_START_PROCESS_SPAWN_COMMAND_SENT = TelemetryPropertyNames.FEATURE_NAME + 'ProcessSpawnCommandSent';
TelemetryPropertyNames.AGENT_START_CONNECTION_RETRY_COUNT = TelemetryPropertyNames.FEATURE_NAME + 'RetryCount';
TelemetryPropertyNames.AGENT_START_CONNECTION_URI_PROTOCOL = TelemetryPropertyNames.FEATURE_NAME + 'UriProtocol';
TelemetryPropertyNames.CLIENT_LOG_LINES = TelemetryPropertyNames.FEATURE_NAME + 'ClientLogLines';
TelemetryPropertyNames.AGENT_LOG_LINES = TelemetryPropertyNames.FEATURE_NAME + 'AgentLogLines';
TelemetryPropertyNames.FEATURE_FLAGS = TelemetryPropertyNames.FEATURE_NAME + 'FeatureFlags';
TelemetryPropertyNames.START_WAITING_FOR_HOST = TelemetryPropertyNames.FEATURE_NAME + 'StartWaitingForHost';
TelemetryPropertyNames.GUEST_CANCELED = TelemetryPropertyNames.FEATURE_NAME + 'GuestCanceled';
exports.TelemetryPropertyNames = TelemetryPropertyNames;

//# sourceMappingURL=telemetry.js.map
