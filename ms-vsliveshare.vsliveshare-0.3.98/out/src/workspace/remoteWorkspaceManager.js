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
const FileServiceTypes_1 = require("./contract/FileServiceTypes");
const service_1 = require("./service");
const remoteStreamImpl_1 = require("./remoteStreamImpl");
const session_1 = require("../session");
const util_1 = require("./../util");
const telemetry_1 = require("../telemetry/telemetry");
const os = require("os");
const collaborators_1 = require("./collaborators");
const lspClient = require("../languageService/lspClient");
const config_1 = require("../config");
const omniSharp = require('../../deps/omnisharp/src/main');
const typeScriptClient = require('../../deps/typescript/extension');
class RemoteWorkspaceManager {
    constructor(workspaceService, fileService) {
        this.workspaceService = workspaceService;
        this.fileService = fileService;
        this.streams = new Map();
        this.api = {
            readLineAsync: (streamId) => this.readLineAsync(streamId),
            readLinesAsync: (streamId, count) => this.readLinesAsync(streamId, count),
            readToEndAsync: (streamId) => this.readToEndAsync(streamId),
            writeLineAsync: (streamId, value) => this.writeLineAsync(streamId, value),
            isRemoteSession: () => this.isRemoteSession()
        };
        this.streamManagerService = new service_1.StreamManagerService(this.client);
        this.streamService = new service_1.StreamService(this.client);
        const typeScriptRemoteStream = new remoteStreamImpl_1.RemoteStreamImpl(this, "typescript_ls" /* TypeScriptLanguageService */);
        this.streams.set("typescript_ls" /* TypeScriptLanguageService */, typeScriptRemoteStream);
        const typeScriptCancellationRemoteStream = new remoteStreamImpl_1.RemoteStreamImpl(this, "typescript_ls_cancellation" /* TypeScriptLanguageServiceCancellation */);
        this.streams.set("typescript_ls_cancellation" /* TypeScriptLanguageServiceCancellation */, typeScriptCancellationRemoteStream);
        const csharpRemoteStream = new remoteStreamImpl_1.RemoteStreamImpl(this, "csharp_ls" /* CSharpLanguageService */);
        this.streams.set("csharp_ls" /* CSharpLanguageService */, csharpRemoteStream);
        session_1.SessionContext.on(collaborators_1.CollaboratorManager.collaboratorsChangedEvent, () => __awaiter(this, void 0, void 0, function* () {
            if (!this.clientLanguageServicesActivated &&
                [session_1.SessionState.JoiningInProgress, session_1.SessionState.Joined].indexOf(session_1.SessionContext.State) >= 0) {
                if (!config_1.featureFlags.lspForCSTS) {
                    if (session_1.SessionContext.collaboratorManager && session_1.SessionContext.collaboratorManager.getCollaboratorCount() === 1) {
                        this.activateOmniSharp();
                        this.activateTypeScriptClient();
                        this.clientLanguageServicesActivated = true;
                    }
                }
            }
        }));
        session_1.SessionContext.on(collaborators_1.CollaboratorManager.collaboratorsChangedEvent, () => __awaiter(this, void 0, void 0, function* () {
            if (!this.clientLspLanguageServicesActivated &&
                [session_1.SessionState.JoiningInProgress, session_1.SessionState.Joined].indexOf(session_1.SessionContext.State) >= 0) {
                if (config_1.featureFlags.multiGuestLsp ||
                    (session_1.SessionContext.collaboratorManager && session_1.SessionContext.collaboratorManager.getCollaboratorCount() === 1)) {
                    yield this.activateLSPClientAsync(this.workspaceService);
                    this.clientLspLanguageServicesActivated = true;
                }
            }
        }));
    }
    get client() {
        return this.workspaceService.client;
    }
    readLineAsync(streamId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.readLinesAsync(streamId, 1);
        });
    }
    readLinesAsync(streamId, count) {
        return __awaiter(this, void 0, void 0, function* () {
            const remoteStream = this.streams.get(streamId);
            return remoteStream ? (yield remoteStream.readLinesAsync(count)).join(os.EOL) : '';
        });
    }
    readToEndAsync(streamId) {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.reject(new Error('Not implemented.'));
        });
    }
    writeLineAsync(streamId, value) {
        return __awaiter(this, void 0, void 0, function* () {
            const remoteStream = this.streams.get(streamId);
            return remoteStream ? yield remoteStream.writeLinesAsync([value]) : false;
        });
    }
    getOwnerRootPathAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.ownerRootPath) {
                const fileListOptions = {
                    includeDetails: false,
                    recurseMode: FileServiceTypes_1.FileRecurseMode.None,
                    excludePatterns: undefined
                };
                const fileRootInfos = yield this.fileService.listRootsAsync(fileListOptions);
                const fileRootInfo = fileRootInfos.shift();
                if (fileRootInfo) {
                    this.ownerRootPath = fileRootInfo.localPath;
                }
            }
            return this.ownerRootPath;
        });
    }
    isRemoteSession() {
        return session_1.SessionContext.State === session_1.SessionState.Joined;
    }
    dispose() {
        this.streams.clear();
    }
    activateOmniSharp() {
        omniSharp.activateLanguageServices(util_1.ExtensionUtil.Context, telemetry_1.Instance, this.api);
    }
    activateTypeScriptClient() {
        typeScriptClient.activate(util_1.ExtensionUtil.Context, this.api);
    }
    activateLSPClientAsync(workspaceService) {
        return __awaiter(this, void 0, void 0, function* () {
            yield lspClient.activateAsync(util_1.ExtensionUtil.Context, workspaceService);
        });
    }
}
exports.RemoteWorkspaceManager = RemoteWorkspaceManager;

//# sourceMappingURL=remoteWorkspaceManager.js.map
