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
const service_1 = require("./service");
const util_1 = require("../util");
class RemoteStreamImpl {
    constructor(remoteWorkspaceManager, streamName) {
        this.remoteWorkspaceManager = remoteWorkspaceManager;
        this.streamName = streamName;
        this.streamService = this.remoteWorkspaceManager.streamService;
        this.streamManagerService = this.remoteWorkspaceManager.streamManagerService;
    }
    readLinesAsync(count) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.remoteWorkspaceManager.isRemoteSession()) {
                return [];
            }
            const remoteStreamId = yield this.getRemoteStreamIdAsync();
            if (remoteStreamId == null) {
                return [];
            }
            try {
                const lines = yield this.streamService.readLinesAsync(remoteStreamId, count);
                // We will get full paths in the owner's format in the lines. Replace the owner's path string with the vsls schema name.
                const ownerRootPath = yield this.remoteWorkspaceManager.getOwnerRootPathAsync();
                return lines.map((line) => util_1.PathUtil.replacePathWithSchemeInLine(line, ownerRootPath));
            }
            catch (e) {
                if (e instanceof service_1.RpcConnectionClosedError) {
                    return [];
                }
                throw e;
            }
        });
    }
    writeLinesAsync(lines) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.remoteWorkspaceManager.isRemoteSession()) {
                return false;
            }
            const remoteStreamId = yield this.getRemoteStreamIdAsync();
            if (remoteStreamId == null) {
                return false;
            }
            // Escape backslashes in a path so that we can put that inside a string inside the line.
            const ownerRootPath = util_1.PathUtil.EscapeBackslash(yield this.remoteWorkspaceManager.getOwnerRootPathAsync());
            // We will get scheme-qualified names in the request. Convert them to regular paths for the owner.
            const remoteValue = lines.map((line) => util_1.PathUtil.replaceSchemeWithPathInLine(line, ownerRootPath), ownerRootPath);
            try {
                yield this.streamService.writeLinesAsync(remoteStreamId, remoteValue);
                return true;
            }
            catch (e) {
                if (e instanceof service_1.RpcConnectionClosedError) {
                    return false;
                }
                throw e;
            }
        });
    }
    getRemoteStreamIdAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.remoteStreamId) {
                this.remoteStreamId = yield this.streamManagerService.getStreamAsync(this.streamName, '');
            }
            return this.remoteStreamId;
        });
    }
}
exports.RemoteStreamImpl = RemoteStreamImpl;

//# sourceMappingURL=remoteStreamImpl.js.map
