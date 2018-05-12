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
//
// Implementation of Live Share for VS Code extension public API.
// See LiveShare.ts for public type definitons.
//
const path = require("path");
const vscode_1 = require("vscode");
const LiveShare_1 = require("./LiveShare");
const session_1 = require("../session");
const WorkspaceServiceTypes_1 = require("../workspace/contract/WorkspaceServiceTypes");
const config = require("../config");
const vscode_jsonrpc_1 = require("vscode-jsonrpc");
const config_1 = require("../config");
const traceSource_1 = require("../tracing/traceSource");
let trace;
/**
 * Implementation of the root API that is used to acquire access to the
 * main Live Share API.
 *
 * An instance of this class is returned by the Live Share extension's
 * activation function.
 */
class LiveShareExtensionApi {
    constructor(rpcClient, workspaceService, workspaceUserService) {
        this.rpcClient = rpcClient;
        this.workspaceService = workspaceService;
        this.workspaceUserService = workspaceUserService;
    }
    getApiAsync(callingExtensionContext, requestedApiVersion) {
        return __awaiter(this, void 0, void 0, function* () {
            checkArg(callingExtensionContext, 'callingExtensionContext', 'object');
            checkArg(requestedApiVersion, 'requestedApiVersion', 'string');
            if (!(config_1.featureFlags && config_1.featureFlags.API)) {
                return null;
            }
            const callingPackageJsonPath = path.join(callingExtensionContext.extensionPath, 'package.json');
            const callingPackage = require(callingPackageJsonPath);
            return new LiveShareApi(callingPackage, requestedApiVersion, this.rpcClient, this.workspaceService, this.workspaceUserService);
        });
    }
}
exports.LiveShareExtensionApi = LiveShareExtensionApi;
/**
 * Main API that enables other VS Code extensions to access Live Share capabilities.
 *
 * An instance of this class is created by the extension API above.
 */
class LiveShareApi {
    constructor(callingPackage, apiVersion, rpcClient, workspaceService, workspaceUserService) {
        this.callingPackage = callingPackage;
        this.apiVersion = apiVersion;
        this.rpcClient = rpcClient;
        this.workspaceService = workspaceService;
        this.workspaceUserService = workspaceUserService;
        this.sessionChangeEvent = new vscode_1.EventEmitter();
        this.currentPeers = [];
        this.peersChangeEvent = new vscode_1.EventEmitter();
        /** When in Host role, tracks the services that are shared via this API. */
        this.sharedServices = {};
        /** When in Guest role, tracks the named services that are provided by the host. */
        this.availableServices = {};
        /** When in Guest role, tracks the service proxies that are obtained via this API. */
        this.serviceProxies = {};
        trace = traceSource_1.traceSource.withName('API');
        trace.info(`Initializing Live Share API ${apiVersion} for ` +
            `${callingPackage.name}@${callingPackage.version}`);
        // Initialize session state.
        this.session = {
            peerNumber: 0,
            role: LiveShare_1.Role.None,
            access: LiveShare_1.Access.None,
            id: null,
        };
        // Register internal event handlers.
        session_1.SessionContext.addListener(session_1.SessionEvents.StateChanged, (state) => this.onSessionStateChanged(state));
        this.workspaceService.onServicesChanged((e) => this.onServicesChanged(e));
        this.workspaceUserService.onSessionChanged((e) => this.onUserSessionChanged(e));
    }
    get onDidChangeSession() {
        return this.sessionChangeEvent.event;
    }
    get peers() {
        return this.currentPeers.slice(0);
    }
    get onDidChangePeers() {
        return this.peersChangeEvent.event;
    }
    share(options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.session.role === LiveShare_1.Role.Guest) {
                throw new Error('Cannot share while joined to another session.');
            }
            else if (this.session.role === LiveShare_1.Role.Host) {
                if (options && options.access) {
                    throw new Error('Cannot change default access ' +
                        'for an already shared session.');
                }
            }
            return yield vscode_1.commands.executeCommand('liveshare.start', options);
        });
    }
    join(link, options) {
        return __awaiter(this, void 0, void 0, function* () {
            checkArg(link, 'link', 'uri');
            if (this.session.role !== LiveShare_1.Role.None) {
                throw new Error('A session is already active.');
            }
            yield vscode_1.commands.executeCommand('liveshare.join', link.toString(), options);
        });
    }
    end() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.session.role === LiveShare_1.Role.Guest) {
                yield vscode_1.commands.executeCommand('liveshare.leave');
            }
            else if (this.session.role === LiveShare_1.Role.Host) {
                yield vscode_1.commands.executeCommand('liveshare.end');
            }
        });
    }
    shareService(name) {
        return __awaiter(this, void 0, void 0, function* () {
            checkArg(name, 'name', 'string');
            name = this.callingPackage.name + '.' + name;
            trace.verbose(`shareService(${name})`);
            let sharedService = this.sharedServices[name];
            if (!sharedService) {
                sharedService = new SharedServiceApi(name, this.rpcClient);
                this.sharedServices[name] = sharedService;
                if (this.session.role === LiveShare_1.Role.Host) {
                    try {
                        trace.verbose(`registerServicesAsync(${name})`);
                        yield this.workspaceService.registerServicesAsync([name], WorkspaceServiceTypes_1.WorkspaceServicesChangeType.Add);
                    }
                    catch (e) {
                        trace.error(e);
                        throw e;
                    }
                    sharedService._isServiceAvailable = true;
                    sharedService._fireIsAvailableChange();
                }
            }
            return sharedService;
        });
    }
    getSharedService(name) {
        return __awaiter(this, void 0, void 0, function* () {
            checkArg(name, 'name', 'string');
            if (name.indexOf('.') < 0) {
                name = this.callingPackage.name + '.' + name;
            }
            trace.verbose(`getSharedService(${name})`);
            let serviceProxy = this.serviceProxies[name];
            if (!serviceProxy) {
                serviceProxy = new SharedServiceApi(name, this.rpcClient);
                this.serviceProxies[name] = serviceProxy;
                if (this.session.role === LiveShare_1.Role.Guest && this.availableServices[name]) {
                    serviceProxy._isServiceAvailable = true;
                }
            }
            return serviceProxy;
        });
    }
    convertLocalUriToShared(localUri) {
        checkArg(localUri, 'localUri', 'uri');
        // TODO: Support VSLS multi-root workspaces
        const scheme = config.get(config.Key.scheme);
        let workspaceFolder = vscode_1.workspace.getWorkspaceFolder(localUri);
        if (!workspaceFolder) {
            throw new Error(`Not a workspace file URI: ${localUri}`);
        }
        let relativePath = vscode_1.workspace.asRelativePath(localUri).replace('\\', '/');
        return vscode_1.Uri.parse(`${scheme}:/${relativePath}`);
    }
    convertSharedUriToLocal(sharedUri) {
        checkArg(sharedUri, 'sharedUri', 'uri');
        if (this.session.role === LiveShare_1.Role.Guest) {
            // Guest role cannot get a local URI for a shared URI.
            return null;
        }
        const scheme = config.get(config.Key.scheme);
        if (sharedUri.scheme !== scheme) {
            throw new Error(`Not a ${config.get(config.Key.shortName)} shared URI: ${sharedUri}`);
        }
        // TODO: Support VSLS multi-root workspaces
        let rootPath = vscode_1.workspace.rootPath;
        let relativePath = sharedUri.path.replace(/[\\\/]/g, path.sep);
        return vscode_1.Uri.file(path.join(rootPath, relativePath));
    }
    /**
     * Callback from session context whenever state changes.
     * We only care about transitions to/from fully shared or joined states.
     */
    onSessionStateChanged(state) {
        return __awaiter(this, void 0, void 0, function* () {
            const newRole = (state === session_1.SessionState.Shared ? LiveShare_1.Role.Host :
                state === session_1.SessionState.Joined ? LiveShare_1.Role.Guest : LiveShare_1.Role.None);
            if (newRole === this.session.role) {
                return;
            }
            let sessionChange = this.session;
            sessionChange.role = newRole;
            let peersChangeEvent = null;
            let changedServices = [];
            if (newRole === LiveShare_1.Role.Host) {
                // A hosted sharing session started. Register any shared services.
                let sharedServiceNames = Object.keys(this.sharedServices);
                if (sharedServiceNames.length > 0) {
                    trace.verbose(`registerServicesAsync(${JSON.stringify(sharedServiceNames)})`);
                    try {
                        yield this.workspaceService.registerServicesAsync(sharedServiceNames, WorkspaceServiceTypes_1.WorkspaceServicesChangeType.Add);
                    }
                    catch (e) {
                        trace.error(e);
                        throw e;
                    }
                    for (let s of sharedServiceNames) {
                        this.sharedServices[s]._isServiceAvailable = true;
                        changedServices.push(this.sharedServices[s]);
                    }
                }
                // Update current session info.
                const sessionInfo = session_1.SessionContext.workspaceSessionInfo;
                sessionChange.peerNumber = sessionInfo.sessionNumber;
                sessionChange.access = LiveShare_1.Access.Owner;
                sessionChange.id = sessionInfo.id || null;
            }
            else if (newRole === LiveShare_1.Role.Guest) {
                // Joined a sharing session as a guest. Make service proxies available.
                for (let s of Object.keys(this.availableServices)) {
                    const serviceProxy = this.serviceProxies[s];
                    if (serviceProxy && this.availableServices[s]) {
                        serviceProxy._isServiceAvailable = true;
                        changedServices.push(serviceProxy);
                    }
                }
                // Update current session info.
                const sessionInfo = session_1.SessionContext.workspaceSessionInfo;
                sessionChange.peerNumber = sessionInfo.sessionNumber;
                sessionChange.access = LiveShare_1.Access.ReadWrite;
                sessionChange.id = sessionInfo.id || null;
                // Initalize peers array, includuing the host and any other already-joined guests.
                if (sessionInfo.sessions && Object.keys(sessionInfo.sessions).length > 0) {
                    const addedPeers = [];
                    for (let sessionNumber of Object.keys(sessionInfo.sessions)) {
                        const sessionNumberInt = parseInt(sessionNumber, 10);
                        if (sessionNumberInt !== sessionInfo.sessionNumber) {
                            const profile = sessionInfo.sessions[sessionNumber];
                            addedPeers.push({
                                peerNumber: sessionNumberInt,
                                role: (sessionNumberInt === 1 ? LiveShare_1.Role.Host : LiveShare_1.Role.Guest),
                                access: (profile.isOwner ? LiveShare_1.Access.Owner : LiveShare_1.Access.ReadWrite),
                            });
                        }
                    }
                    if (addedPeers.length > 0) {
                        peersChangeEvent = { added: addedPeers, removed: [] };
                        this.currentPeers.push(...addedPeers);
                    }
                }
            }
            else {
                // The sharing session ended. Notify shared services and service proxies.
                for (let s of Object.keys(this.serviceProxies)) {
                    const service = this.serviceProxies[s];
                    if (service.isServiceAvailable) {
                        service._isServiceAvailable = false;
                        changedServices.push(service);
                    }
                }
                for (let s of Object.keys(this.sharedServices)) {
                    const service = this.sharedServices[s];
                    if (service.isServiceAvailable) {
                        service._isServiceAvailable = false;
                        changedServices.push(service);
                    }
                }
                // Clear current session info.
                sessionChange.peerNumber = 0;
                sessionChange.access = LiveShare_1.Access.None;
                sessionChange.id = null;
                // Clear peers array.
                if (this.currentPeers.length > 0) {
                    peersChangeEvent = {
                        added: [],
                        removed: this.currentPeers.splice(0, this.currentPeers.length),
                    };
                }
            }
            // Raise all events at the end, after all state was updated.
            trace.verbose(`^onDidChangeSession(${LiveShare_1.Role[newRole]})`);
            this.sessionChangeEvent.fire({ session: this.session });
            if (peersChangeEvent) {
                trace.verbose(`^onDidChangePeers(${JSON.stringify(peersChangeEvent)})`);
                this.peersChangeEvent.fire(peersChangeEvent);
            }
            for (let s of changedServices) {
                s._fireIsAvailableChange();
            }
        });
    }
    /**
     * Callback from workspace service whenever available RPC services changed.
     * We only care about prefixed services (registered via public API).
     */
    onServicesChanged(e) {
        // Filter out internal service names - the ones with no package name prefix.
        const changedServiceNames = e.serviceNames
            .filter(s => s.indexOf('.') >= 0);
        if (e.changeType === WorkspaceServiceTypes_1.WorkspaceServicesChangeType.Add) {
            for (let s of changedServiceNames) {
                // Save the availablilty of the service in case a proxy is requested.
                this.availableServices[s] = true;
                // If a proxy for the service exists, it's now available (if in Guest role).
                const serviceProxy = this.serviceProxies[s];
                if (serviceProxy && !serviceProxy.isServiceAvailable &&
                    this.session.role === LiveShare_1.Role.Guest) {
                    serviceProxy._isServiceAvailable = true;
                    serviceProxy._fireIsAvailableChange();
                }
            }
        }
        else if (e.changeType === WorkspaceServiceTypes_1.WorkspaceServicesChangeType.Remove) {
            for (let s of changedServiceNames) {
                // Save the availablilty of the service in case a proxy is requested.
                this.availableServices[s] = false;
                // If a proxy for the service exists, it's now unavailable.
                const serviceProxy = this.serviceProxies[s];
                if (serviceProxy && serviceProxy.isServiceAvailable) {
                    serviceProxy._isServiceAvailable = false;
                    serviceProxy._fireIsAvailableChange();
                }
            }
        }
    }
    /**
     * Callback from workspace user service whenever participants change.
     */
    onUserSessionChanged(e) {
        if (e.sessionNumber === this.session.peerNumber) {
            // Skip notifications about myself; that's handled as part of
            // the session state change.
            return;
        }
        if (e.changeType === WorkspaceServiceTypes_1.WorkspaceSessionChangeType.Joined) {
            const peer = {
                peerNumber: e.sessionNumber,
                role: LiveShare_1.Role.Guest,
                access: LiveShare_1.Access.ReadWrite,
            };
            this.currentPeers.push(peer);
            trace.verbose(`^onDidChangePeers(added: ${JSON.stringify(peer)})`);
            this.peersChangeEvent.fire({ added: [peer], removed: [] });
        }
        else if (e.changeType === WorkspaceServiceTypes_1.WorkspaceSessionChangeType.Unjoined) {
            const i = this.currentPeers.findIndex(p => p.peerNumber === e.sessionNumber);
            if (i >= 0) {
                const peer = this.currentPeers.splice(i, 1)[0];
                trace.verbose(`^onDidChangePeers(removed: ${JSON.stringify(peer)})`);
                this.peersChangeEvent.fire({ added: [], removed: [peer] });
            }
        }
    }
}
exports.LiveShareApi = LiveShareApi;
/**
 * Implements both the service and service proxy interfaces.
 */
class SharedServiceApi {
    constructor(name, rpcClient) {
        this.name = name;
        this.rpcClient = rpcClient;
        this.isAvailable = false;
        this.isAvailableChange = new vscode_1.EventEmitter();
    }
    get isServiceAvailable() { return this.isAvailable; }
    get onDidChangeIsServiceAvailable() {
        return this.isAvailableChange.event;
    }
    /* internal */ set _isServiceAvailable(value) {
        this.isAvailable = value;
    }
    /* internal */ _fireIsAvailableChange() {
        trace.verbose(`^onDidChangeIsServiceAvailable(${this.name}, ${this.isAvailable})`);
        this.isAvailableChange.fire(this.isAvailable);
    }
    handleRequest(name, handler) {
        checkArg(name, 'name', 'string');
        checkArg(handler, 'handler', 'function');
        const rpcName = this.makeRpcName(name);
        trace.verbose(`handleRequest(${rpcName})`);
        this.rpcClient.connection.onRequest(rpcName, (...args) => __awaiter(this, void 0, void 0, function* () {
            trace.verbose(`onRequest(${rpcName})`);
            try {
                handler(args);
            }
            catch (e) {
                trace.warning(`Request handler (${rpcName}) failed: ` + e.message);
                let stack = e.stack;
                if (stack) {
                    // Strip off the part of the stack that is not in the extension code.
                    stack = stack.replace(new RegExp('\\s+at ' + SharedServiceApi.name + '(.*\n?)+'), '');
                }
                return new vscode_jsonrpc_1.ResponseError(vscode_jsonrpc_1.ErrorCodes.UnknownErrorCode, e.message, stack);
            }
        }));
    }
    handleNotification(name, handler) {
        checkArg(name, 'name', 'string');
        checkArg(handler, 'handler', 'function');
        const rpcName = this.makeRpcName(name);
        trace.verbose(`handleNotification(${rpcName})`);
        this.rpcClient.connection.onNotification(rpcName, (...argsArray) => {
            const args = argsArray[0];
            trace.verbose(`onNotification(${rpcName})`);
            try {
                handler(args);
            }
            catch (e) {
                trace.warning(`Notification handler (${rpcName}) failed: ` + e.message);
                // Notifications have no response, so no error details are returned.
            }
        });
    }
    request(name, args, cancellation) {
        return __awaiter(this, void 0, void 0, function* () {
            checkArg(name, 'name', 'string');
            checkArg(args, 'args', 'array');
            const rpcName = this.makeRpcName(name);
            if (!this.isServiceAvailable) {
                trace.warning(`request(${rpcName}) - service not available`);
                throw new SharedServiceProxyError('Service \'' + this.name + '\' is not available.');
            }
            trace.verbose(`request(${rpcName})`);
            let responsePromise;
            try {
                responsePromise = this.rpcClient.connection.sendRequest(rpcName, ...args);
            }
            catch (e) {
                trace.warning(`request(${rpcName}) failed: ` + e.message);
                throw new SharedServiceProxyError(e.message);
            }
            let response;
            try {
                response = yield responsePromise;
            }
            catch (e) {
                trace.warning(`request(${rpcName}) failed: ` + e.message);
                throw new SharedServiceResponseError(e.message, e.data);
            }
            trace.verbose(`request(${rpcName}) succeeded`);
            return response;
        });
    }
    notify(name, args) {
        checkArg(name, 'name', 'string');
        checkArg(args, 'args', 'object');
        const rpcName = this.makeRpcName(name);
        if (!this.isServiceAvailable) {
            trace.verbose(`notify(${rpcName}}) - service not available`);
            // Notifications do nothing when the service is not available.
            return;
        }
        trace.verbose(`notify(${rpcName})`);
        try {
            this.rpcClient.connection.sendNotification(rpcName, args);
        }
        catch (e) {
            trace.warning(`notify(${rpcName}) failed: ` + e.message);
            throw new SharedServiceProxyError(e.message);
        }
    }
    makeRpcName(name) {
        return this.name + '.' + name;
    }
}
class SharedServiceProxyError extends Error {
    constructor(message) {
        super(message);
        this.name = SharedServiceProxyError.name;
    }
}
class SharedServiceResponseError extends Error {
    constructor(message, remoteStack) {
        super(message);
        this.remoteStack = remoteStack;
        this.name = SharedServiceResponseError.name;
    }
}
function checkArg(value, name, type) {
    if (!value) {
        throw new Error('Argument \'' + name + '\' is required.');
    }
    else if (type) {
        if (type === 'array') {
            if (!Array.isArray(value)) {
                throw new Error('Argument \'' + name + '\' must be an array.');
            }
        }
        else if (type === 'uri') {
            if (!(value instanceof vscode_1.Uri)) {
                throw new Error('Argument \'' + name + '\' must be a Uri object.');
            }
        }
        else if (type === 'object' && Array.isArray(value)) {
            throw new Error('Argument \'' + name + '\' must be a a non-array object.');
        }
        else if (typeof value !== type) {
            throw new Error('Argument \'' + name + '\' must be type \'' + type + '\'.');
        }
    }
}

//# sourceMappingURL=LiveShareApi.js.map
