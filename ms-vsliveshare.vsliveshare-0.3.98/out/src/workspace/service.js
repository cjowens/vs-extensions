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
const events = require("events");
const url = require("url");
const rpc = require("vscode-jsonrpc");
const net = require("net");
const traceSource_1 = require("../tracing/traceSource");
const util_1 = require("../util");
const wm = require("./contract/WorkspaceServiceTypes");
const agent_1 = require("../agent");
const telemetry_1 = require("../telemetry/telemetry");
const remoteServiceTelemetry_1 = require("../telemetry/remoteServiceTelemetry");
class RPCClient {
    constructor() {
        this.maxRetryCount = 9;
        this.starRequests = {};
        this.starNotificationsCookies = 0;
        this.starNotifications = new Map();
        this.dispose = (e) => {
            if (!this.disposed) {
                if (this.connection) {
                    this.connection.dispose();
                    this.connection = null;
                }
                if (this.socket) {
                    this.socket.destroy();
                    this.socket = null;
                }
                this.disposed = true;
                if (e) {
                    this.initPromise = Promise.reject(e);
                }
                else {
                    // The instance was disposed during extension deactivation.
                    // Create an init promise that never resolves, to block any
                    // further communication attempts during extension deactivation.
                    this.initPromise = new Promise((resolve) => { });
                }
            }
        };
        this.trace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpc);
        // Start but don't await yet. Save the promise for later.
        this.agentStarting = agent_1.Agent.startIfNotRunning();
    }
    init(retryCount = this.maxRetryCount, retryInterval = null) {
        return __awaiter(this, void 0, void 0, function* () {
            const currentRetryInterval = retryInterval || (retryCount === this.maxRetryCount ? 50 : 100);
            this.agentUri = yield this.agentStarting;
            yield new Promise((resolve, reject) => {
                let startEvent = telemetry_1.Instance.startTimedEvent(telemetry_1.TelemetryEventNames.START_AGENT_CONNECTION);
                startEvent.addProperty(telemetry_1.TelemetryPropertyNames.AGENT_START_CONNECTION_RETRY_COUNT, (this.maxRetryCount - retryCount).toString());
                startEvent.addProperty(telemetry_1.TelemetryPropertyNames.AGENT_START_CONNECTION_URI_PROTOCOL, this.agentUri.protocol);
                let didSucceed = false;
                if (this.agentUri.protocol === 'net.tcp:' &&
                    this.agentUri.hostname === 'localhost' &&
                    this.agentUri.port) {
                    const port = parseInt(this.agentUri.port, 10);
                    this.socket = net.createConnection({ port: port });
                }
                else if (this.agentUri.protocol === 'net.pipe:' && this.agentUri.hostname === 'localhost') {
                    const pipe = this.agentUri.pathname.substr(1);
                    this.socket = net.createConnection(util_1.getPipePath(pipe));
                }
                else {
                    reject(new Error('Invalid agent URI: ' + url.format(this.agentUri)));
                    return;
                }
                this.connection = rpc.createMessageConnection(this.socket, this.socket, this);
                this.socket.on('connect', () => {
                    didSucceed = true;
                    this.trace.info('Agent connection success - ' + url.format(this.agentUri));
                    startEvent.end(telemetry_1.TelemetryResult.Success, 'Agent connection success.');
                    resolve();
                });
                this.connection.onError((error) => {
                    const e = error[0];
                    if (retryCount > 0) {
                        this.connection.dispose();
                        this.socket.destroy();
                        this.trace.verbose('Agent connection not completed: ' + e + '; Retrying...');
                        // Recursive call
                        setTimeout(() => {
                            this.init(--retryCount, retryInterval)
                                .then(() => resolve())
                                .catch(reject);
                        }, currentRetryInterval);
                    }
                    else {
                        if (!didSucceed) {
                            startEvent.end(telemetry_1.TelemetryResult.Failure, 'Agent connection failed. ' + e);
                        }
                        // No more retries. Dispose with the error from the last connection attempt.
                        this.dispose(e);
                        this.trace.error('Agent connection failed: ' + e);
                        reject(e);
                    }
                });
                this.connection.onClose(() => {
                    this.trace.info('RPC connection closed.');
                    if (!this.disposed) {
                        // The connection was closed unexpectedly (not due to extension deactivation).
                        // Dispose with an error that causes further communication attemps to be
                        // rejected with an appropriate exception.
                        this.dispose(new RpcConnectionClosedError());
                    }
                });
                // add generic request support
                this.connection.onRequest((method, ...params) => __awaiter(this, void 0, void 0, function* () {
                    if (!this.starRequests.hasOwnProperty(method)) {
                        return new rpc.ResponseError(rpc.ErrorCodes.MethodNotFound, `method:${method} not supported`);
                    }
                    return yield this.starRequests[method](...params);
                }));
                // add generic notification support
                this.connection.onNotification((method, ...params) => __awaiter(this, void 0, void 0, function* () {
                    if (this.starNotifications.has(method)) {
                        this.starNotifications.get(method).forEach((item) => __awaiter(this, void 0, void 0, function* () {
                            yield item.notificationHandler(...params);
                        }));
                    }
                }));
                this.connection.listen();
            });
        });
    }
    ensureConnectionAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!!this.initPromise) {
                // some other async caller is already connecting
                yield this.initPromise;
            }
            if (!this.connection) {
                // the caller is connecting
                this.initPromise = this.init();
                yield this.initPromise;
            }
            // connected
            return this.connection;
        });
    }
    onConnect(handler) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureConnectionAsync();
            handler();
        });
    }
    onClose(handler) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureConnectionAsync();
            this.connection.onClose(handler);
        });
    }
    error(message) {
        this.trace.error(message);
    }
    warn(message) {
        this.trace.warning(message);
    }
    info(message) {
        this.trace.info(message);
    }
    log(message) {
        this.trace.verbose(message);
    }
    sendRequest(trace, serviceAndMethodName, ...args) {
        return __awaiter(this, void 0, void 0, function* () {
            const connection = yield this.ensureConnectionAsync();
            let argsString = '';
            if (traceSource_1.TraceFormat.disableObfuscation) {
                // Arguments may contain sensitive data, so only trace when obfuscation is disabled.
                argsString = JSON.stringify(args);
                argsString = argsString.substr(1, argsString.length - 2);
            }
            trace.verbose(`< ${serviceAndMethodName}(${argsString})`);
            let result;
            try {
                result = yield connection.sendRequest(serviceAndMethodName, args);
            }
            catch (err) {
                if (this.disposed) {
                    // This will either block (during deactivation) or throw a connection-closed error.
                    yield this.initPromise;
                }
                // The error 'data' property should be the remote stack trace.
                // If it's not present just report the local stack trace.
                let errorMessage = err.data || err.stack;
                trace.error(`> ${serviceAndMethodName}() error: ` + errorMessage);
                throw err;
            }
            // Result may contain sensitive data, so only trace when obfuscation is disabled.
            if (traceSource_1.TraceFormat.disableObfuscation) {
                trace.verbose(`> ${serviceAndMethodName}() => ${JSON.stringify(result)}`);
            }
            else {
                trace.verbose(`> ${serviceAndMethodName}() succeeded`);
            }
            return result;
        });
    }
    sendNotification(trace, serviceAndName, eventArgs) {
        return __awaiter(this, void 0, void 0, function* () {
            const connection = yield this.ensureConnectionAsync();
            // Event args may contain sensitive data, so only trace when obfuscation is disabled.
            const argsString = traceSource_1.TraceFormat.disableObfuscation ? JSON.stringify(eventArgs) : '';
            trace.verbose(`sendNotification-> ${serviceAndName}: ${argsString}`);
            connection.sendNotification(serviceAndName, eventArgs);
        });
    }
    addRequestMethod(method, requestHandler) {
        this.starRequests[method] = requestHandler;
    }
    removeRequestMethod(method) {
        let val = this.starRequests[method];
        delete this.starRequests[method];
        return val;
    }
    addNotificationHandler(method, notificationHandler) {
        let entrys = this.starNotifications.get(method);
        if (!entrys) {
            entrys = [];
            this.starNotifications.set(method, entrys);
        }
        const entry = {
            cookie: ++this.starNotificationsCookies,
            notificationHandler: notificationHandler
        };
        entrys.push(entry);
        return entry.cookie;
    }
    removeNotificationHandler(method, cookie) {
        let entrys = this.starNotifications.get(method);
        if (entrys) {
            const indexEntry = entrys.findIndex(i => i.cookie === cookie);
            if (indexEntry !== -1) {
                return entrys.splice(indexEntry, 1)[0].notificationHandler;
            }
        }
        return undefined;
    }
}
exports.RPCClient = RPCClient;
/**
 * Error thrown from RPC requests when the connection to the agent was unexpectedly
 * closed before or during the request.
 */
class RpcConnectionClosedError extends Error {
    constructor() {
        super('RPC connection closed.');
        this.code = RpcConnectionClosedError.code;
        Object.setPrototypeOf(this, RpcConnectionClosedError.prototype);
    }
}
/** One of the well-known Node.js error code strings. */
RpcConnectionClosedError.code = 'ECONNRESET';
exports.RpcConnectionClosedError = RpcConnectionClosedError;
/**
 * Base class for RPC service clients. Traces all messages
 * and emits events for incoming notifications.
 */
class RpcServiceClient extends events.EventEmitter {
    constructor(client, serviceName, trace) {
        super();
        this.client = client;
        this.serviceName = serviceName;
        this.trace = trace;
    }
    registerEvent(eventName) {
        return __awaiter(this, void 0, void 0, function* () {
            const serviceAndEventName = this.serviceName + '.' + eventName;
            const handler = (...args) => {
                const eventArgs = args[0];
                // Event args may contain sensitive data, so only trace when obfuscation is disabled.
                const argsString = traceSource_1.TraceFormat.disableObfuscation ? JSON.stringify(eventArgs) : '';
                this.trace.verbose(`> ${serviceAndEventName}: ${argsString}`);
                this.emit(eventName, eventArgs);
            };
            const connection = yield this.client.ensureConnectionAsync();
            connection.onNotification(serviceAndEventName, handler);
        });
    }
    invoke(methodName, ...args) {
        return __awaiter(this, void 0, void 0, function* () {
            const serviceAndMethodName = this.serviceName + '.' + methodName;
            return this.client.sendRequest(this.trace, serviceAndMethodName, ...args);
        });
    }
    invokeNotification(methodName, args) {
        return __awaiter(this, void 0, void 0, function* () {
            const serviceAndMethodName = this.serviceName + '.' + methodName;
            return this.client.sendNotification(this.trace, serviceAndMethodName, args);
        });
    }
    dispose() {
        /* empty */
    }
}
exports.RpcServiceClient = RpcServiceClient;
class FileService extends RpcServiceClient {
    constructor(client) {
        super(client, 'file', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcFile));
        this.registerEvent(FileService.filesChangedEvent);
    }
    listRootsAsync(fileListOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('listRoots', fileListOptions);
        });
    }
    readTextAsync(filePath, fileReadOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('readText', filePath, fileReadOptions);
        });
    }
    listAsync(paths, fileListOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('list', paths, fileListOptions);
        });
    }
    writeTextAsync(p, text, fileWriteOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('writeText', p, text, fileWriteOptions);
        });
    }
    createDirectoryAsync(p) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('createDirectory', p);
        });
    }
    copyAsync(sourcePath, targetPath, fileMoveOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('copy', sourcePath, targetPath, fileMoveOptions);
        });
    }
    moveAsync(sourcePath, targetPath, fileMoveOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('move', sourcePath, targetPath, fileMoveOptions);
        });
    }
    deleteAsync(p, fileDeleteOptions) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('delete', p, fileDeleteOptions);
        });
    }
    onFilesChanged(handler) {
        this.on(FileService.filesChangedEvent, handler);
    }
}
FileService.filesChangedEvent = 'filesChanged';
exports.FileService = FileService;
class StreamService extends RpcServiceClient {
    constructor(client) {
        super(client, 'stream', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcStream));
    }
    readLinesAsync(id, count) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('readLines', id, count);
        });
    }
    writeLinesAsync(id, lines) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('writeLines', id, lines);
        });
    }
}
exports.StreamService = StreamService;
class StreamManagerService extends RpcServiceClient {
    constructor(client) {
        super(client, 'streamManager', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcStreamManager));
    }
    getStreamAsync(id, condition) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getStream', id, condition);
        });
    }
}
exports.StreamManagerService = StreamManagerService;
class FirewallService extends RpcServiceClient {
    constructor(client) {
        super(client, 'firewall', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpc));
    }
    getFirewallStatusAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getFirewallStatus');
        });
    }
}
exports.FirewallService = FirewallService;
class WorkspaceService extends RpcServiceClient {
    constructor(client) {
        super(client, 'workspace', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcWorkspace));
        this.registeredServices = new Set();
        this.registerEvent(WorkspaceService.connectionStatusChangedEvent);
        this.registerEvent(WorkspaceService.progressUpdatedEvent);
        this.registerEvent(WorkspaceService.servicesChangedEvent);
        this.registerEvent(WorkspaceService.userRemovedEvent);
        this.client.onClose(() => {
            const e = {
                connectionStatus: wm.WorkspaceConnectionStatus.Disconnected,
                disconnectedReason: wm.WorkspaceDisconnectedReason.InternalError,
            };
            this.emit(WorkspaceService.connectionStatusChangedEvent, e);
        });
        this.onServicesChanged((e) => {
            if (e.changeType === wm.WorkspaceServicesChangeType.Add) {
                e.serviceNames.forEach(s => {
                    this.registeredServices.add(s);
                });
            }
            else if (e.changeType === wm.WorkspaceServicesChangeType.Remove) {
                e.serviceNames.forEach(s => {
                    this.registeredServices.delete(s);
                });
            }
        });
    }
    getWorkspaceAsync(workspaceId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getWorkspace', workspaceId);
        });
    }
    joinWorkspaceAsync(workspaceJoinInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('joinWorkspace', workspaceJoinInfo);
        });
    }
    shareWorkspaceAsync(workspaceShareInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('shareWorkspace', workspaceShareInfo);
        });
    }
    unshareWorkspaceAsync(workspaceId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('unshareWorkspace', workspaceId);
        });
    }
    unjoinWorkspaceAsync(workspaceId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('unjoinWorkspace', workspaceId);
        });
    }
    registerServicesAsync(serviceNames, changeType) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('registerServices', serviceNames, changeType);
        });
    }
    onConnectionStatusChanged(handler) {
        this.on(WorkspaceService.connectionStatusChangedEvent, handler);
    }
    onProgressUpdated(handler) {
        this.on(WorkspaceService.progressUpdatedEvent, handler);
    }
    onServicesChanged(handler) {
        this.on(WorkspaceService.servicesChangedEvent, handler);
    }
}
WorkspaceService.connectionStatusChangedEvent = 'connectionStatusChanged';
WorkspaceService.progressUpdatedEvent = 'progressUpdated';
WorkspaceService.servicesChangedEvent = 'servicesChanged';
WorkspaceService.userRemovedEvent = 'userRemoved';
exports.WorkspaceService = WorkspaceService;
class WorkspaceUserService extends RpcServiceClient {
    constructor(client) {
        super(client, 'workspaceuser', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcWorkspaceUser));
        this.registerEvent(WorkspaceUserService.sessionChangedEvent);
    }
    acceptOrRejectGuestAsync(sessionNumber, accept) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('acceptOrRejectGuest', sessionNumber, accept);
        });
    }
    removeUserAsync(sessionNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('removeUser', sessionNumber);
        });
    }
    onSessionChanged(handler) {
        this.on(WorkspaceUserService.sessionChangedEvent, handler);
    }
    fireProgressUpdatedToGuest(progress, sessionNumber) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('fireProgressUpdatedToGuest', progress, sessionNumber);
        });
    }
}
WorkspaceUserService.sessionChangedEvent = 'workspaceSessionChanged';
exports.WorkspaceUserService = WorkspaceUserService;
class TelemetryService extends RpcServiceClient {
    constructor(client) {
        super(client, 'telemetry', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpc));
        client.addNotificationHandler('telemetry.genericOperation', (e) => {
            telemetry_1.Instance.genericOperation(e.eventName, e.result, e.payload);
        });
    }
    initializeAsync(settings) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('initialize', settings);
        });
    }
    getServiceUriAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getServiceUri');
        });
    }
}
exports.TelemetryService = TelemetryService;
class AuthenticationService extends RpcServiceClient {
    constructor(client) {
        super(client, 'auth', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcAuth));
    }
    getLoginUriAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getLoginUri');
        });
    }
    findLoginCodeAsync(extensionInstanceId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('findLoginCode', extensionInstanceId);
        });
    }
    loginAsync(authToken, options) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('login', authToken, options);
        });
    }
    loginWithCachedTokenAsync(accountInfo, options) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('loginWithCachedToken', accountInfo, options);
        });
    }
    logoutAsync(options) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('logout', options);
        });
    }
    getCurrentUserAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getCurrentUser');
        });
    }
}
exports.AuthenticationService = AuthenticationService;
class PortForwardingService extends RpcServiceClient {
    constructor(client) {
        super(client, 'portForwarding', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcPortForwarding));
        this.registerEvent(PortForwardingService.sharingStartedEvent);
        this.registerEvent(PortForwardingService.sharingStoppedEvent);
        this.registerEvent(PortForwardingService.sharingChangedEvent);
        this.registerEvent(PortForwardingService.browseSharingStartedEvent);
    }
    getSharedServersAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getSharedServers');
        });
    }
    onSharingStarted(handler) {
        this.on(PortForwardingService.sharingStartedEvent, handler);
    }
    onSharingStopped(handler) {
        this.on(PortForwardingService.sharingStoppedEvent, handler);
    }
    onBrowseSharingStarted(handler) {
        this.on(PortForwardingService.browseSharingStartedEvent, handler);
    }
    onSharingChanged(handler) {
        this.on(PortForwardingService.sharingChangedEvent, handler);
    }
}
PortForwardingService.sharingStartedEvent = 'sharingStarted';
PortForwardingService.sharingStoppedEvent = 'sharingStopped';
PortForwardingService.sharingChangedEvent = 'sharingChanged';
PortForwardingService.browseSharingStartedEvent = 'browseSharingStarted';
exports.PortForwardingService = PortForwardingService;
class ServerSharingService extends RpcServiceClient {
    constructor(client) {
        super(client, 'serverSharing', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcServerSharing));
        this.registerEvent(ServerSharingService.sharingStartedEvent);
        this.registerEvent(ServerSharingService.sharingStoppedEvent);
        this.registerEvent(ServerSharingService.sharingChangedEvent);
        this.registerEvent(ServerSharingService.browseSharingStartedEvent);
    }
    getSharedServersAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getSharedServers');
        });
    }
    startSharingAsync(port, sessionName, browseUrl) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('startSharing', port, sessionName || `localhost:${port}`, browseUrl || null);
        });
    }
    stopSharingAsync(port) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('stopSharing', port || 0);
        });
    }
    stopSharingBrowseSessionsAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('stopSharingBrowseSessions');
        });
    }
    updateSessionNameAsync(port, newSessionName) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('updateSessionName', port, newSessionName);
        });
    }
    onSharingStarted(handler) {
        this.on(ServerSharingService.sharingStartedEvent, handler);
    }
    onBrowseSharingStarted(handler) {
        this.on(ServerSharingService.browseSharingStartedEvent, handler);
    }
    onSharingStopped(handler) {
        this.on(ServerSharingService.sharingStoppedEvent, handler);
    }
    onSharingChanged(handler) {
        this.on(ServerSharingService.sharingChangedEvent, handler);
    }
}
ServerSharingService.sharingStartedEvent = 'sharingStarted';
ServerSharingService.sharingStoppedEvent = 'sharingStopped';
ServerSharingService.sharingChangedEvent = 'sharingChanged';
ServerSharingService.browseSharingStartedEvent = 'browseSharingStarted';
exports.ServerSharingService = ServerSharingService;
class TerminalService extends RpcServiceClient {
    constructor(client) {
        super(client, 'terminal', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcTerminal));
        this.registerEvent(TerminalService.terminalStartedEvent);
        this.registerEvent(TerminalService.terminalResizedEvent);
        this.registerEvent(TerminalService.terminalStoppedEvent);
    }
    startTerminalAsync(options) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('startTerminal', options);
        });
    }
    getRunningTerminalsAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getRunningTerminals');
        });
    }
    resizeTerminalAsync(terminalId, cols, rows) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('resizeTerminal', terminalId, cols, rows);
        });
    }
    stopTerminalAsync(terminalId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('stopTerminal', terminalId);
        });
    }
    onTerminalStarted(handler) {
        this.on(TerminalService.terminalStartedEvent, handler);
    }
    onTerminalResized(handler) {
        this.on(TerminalService.terminalResizedEvent, handler);
    }
    onTerminalStopped(handler) {
        this.on(TerminalService.terminalStoppedEvent, handler);
    }
}
TerminalService.terminalStartedEvent = 'terminalStarted';
TerminalService.terminalResizedEvent = 'terminalResized';
TerminalService.terminalStoppedEvent = 'terminalStopped';
exports.TerminalService = TerminalService;
class SourceEventService extends RpcServiceClient {
    constructor(client) {
        super(client, 'sourceEvent', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpcSourceEvent));
        this.registerEvent(SourceEventService.eventEvent);
    }
    fireEventAsync(sourceId, jsonContent) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('fireEvent', sourceId, jsonContent);
        });
    }
    setSourceDataAsync(sourceId, jsonContent, fireEvent) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('setSourceData', sourceId, jsonContent, fireEvent);
        });
    }
    getSourceDataAsync(sourceId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke('getSourceData', sourceId);
        });
    }
    onEvent(handler) {
        this.on(SourceEventService.eventEvent, handler);
    }
}
SourceEventService.eventEvent = 'event';
exports.SourceEventService = SourceEventService;
class VersionService extends RpcServiceClient {
    constructor(client) {
        super(client, 'version', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpc));
    }
    exchangeVersionsAsync(clientVersion) {
        return this.invoke('exchangeVersions', null, clientVersion);
    }
}
exports.VersionService = VersionService;
class LanguageServerProviderClient extends RpcServiceClient {
    constructor(client, serviceName) {
        super(client, serviceName, traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientLSP));
        this.registerEvent(LanguageServerProviderClient.notified);
    }
    getMetadataAsync() {
        return this.invoke('getMetadata');
    }
    requestAsync(requestMessage, coeditingInfo) {
        return this.invoke('request', requestMessage, coeditingInfo);
    }
    notifyAsync(notificationMessage) {
        return this.invokeNotification('notify', notificationMessage);
    }
    onNotified(handler) {
        this.on(LanguageServerProviderClient.notified, handler);
    }
}
LanguageServerProviderClient.notified = 'notified';
LanguageServerProviderClient.prefixServiceName = 'languageServerProvider-';
exports.LanguageServerProviderClient = LanguageServerProviderClient;
class WorkspaceTaskService extends RpcServiceClient {
    constructor(client) {
        super(client, 'workspaceTask', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpc));
        this.registerEvent(WorkspaceTaskService.taskStartedEvent);
        this.registerEvent(WorkspaceTaskService.taskTerminatedEvent);
    }
    getSupportedTasks() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return this.invoke('getSupportedTasks');
            }
            catch (error) {
                remoteServiceTelemetry_1.RemoteServiceTelemetry.sendClientFault(this.serviceName, 'getSupportedTasks', error);
                throw error;
            }
        });
    }
    getTaskExecutions() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return this.invoke('getTaskExecutions');
            }
            catch (error) {
                remoteServiceTelemetry_1.RemoteServiceTelemetry.sendClientFault(this.serviceName, 'getTaskExecutions', error);
                throw error;
            }
        });
    }
    runTask(taskUid) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return this.invoke('runTask', taskUid);
            }
            catch (error) {
                remoteServiceTelemetry_1.RemoteServiceTelemetry.sendClientFault(this.serviceName, 'runTask', error);
                throw error;
            }
        });
    }
    onTaskStarted(handler) {
        this.on(WorkspaceTaskService.taskStartedEvent, handler);
    }
    onTaskTerminated(handler) {
        this.on(WorkspaceTaskService.taskTerminatedEvent, handler);
    }
}
WorkspaceTaskService.taskStartedEvent = 'taskStarted';
WorkspaceTaskService.taskTerminatedEvent = 'taskTerminated';
exports.WorkspaceTaskService = WorkspaceTaskService;
class BrokerManagerService extends RpcServiceClient {
    constructor(client) {
        super(client, 'brokerManager', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpc));
    }
    register(brokerManifest) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return this.invoke('register', brokerManifest);
            }
            catch (error) {
                remoteServiceTelemetry_1.RemoteServiceTelemetry.sendClientFault(this.serviceName, 'register', error);
                throw error;
            }
        });
    }
}
exports.BrokerManagerService = BrokerManagerService;
class TaskBrokerService extends RpcServiceClient {
    constructor(client) {
        super(client, 'taskBroker', traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientRpc));
        this.registerEvent(TaskBrokerService.taskExecutionHandledEvent);
    }
    onTaskExecutionHandled(handler) {
        this.on(TaskBrokerService.taskExecutionHandledEvent, handler);
    }
}
TaskBrokerService.taskExecutionHandledEvent = 'taskExecutionHandled';
exports.TaskBrokerService = TaskBrokerService;

//# sourceMappingURL=service.js.map
