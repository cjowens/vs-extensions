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
const buffer = require("buffer");
const traceSource_1 = require("../tracing/traceSource");
const wm = require("./contract/WorkspaceServiceTypes");
const fm = require("./contract/FileServiceTypes");
const service_1 = require("./service");
const url = require("url");
const session_1 = require("../session");
const config = require("../config");
class DeprecatedWorkspaceProvider {
    constructor(workspaceService, fileService, cmnds, root) {
        this.workspaceService = workspaceService;
        this.fileService = fileService;
        this.cmnds = cmnds;
        this.root = root;
        this.onFilesChangedEmitter = new vscode.EventEmitter();
        // FileSystemProvider members
        this.onDidChange = this.onFilesChangedEmitter.event;
        this.getFileStat = (fileInfo, id) => {
            let fileStat = {
                id: id,
                mtime: fileInfo.mtime ? Date.parse(fileInfo.mtime) : 0,
                size: fileInfo.size ? fileInfo.size : 0,
                type: fileInfo.isDirectory ? 1 /* vscode.FileType.Dir */ : 0 /* vscode.FileType.File */
            };
            return fileStat;
        };
        this.trace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientFileProvider);
        this.workspaceService.addListener(service_1.WorkspaceService.connectionStatusChangedEvent, (e) => this.onWorkspaceConnectionStatusChanged(e));
        this.fileService.onFilesChanged((e) => this.onFilesChanged(e));
    }
    onWorkspaceConnectionStatusChanged(e) {
        this.currentConnectionStatus = e.connectionStatus;
    }
    onFilesChanged(e) {
        const changes = e.changes.map(change => {
            const fileChange = {
                type: DeprecatedWorkspaceProvider.toFileChangeType(change.changeType),
                resource: vscode.Uri.parse(config.get(config.Key.scheme) + ':/' + change.path)
            };
            return fileChange;
        });
        this.onFilesChangedEmitter.fire(changes);
    }
    static toFileChangeType(changeType) {
        switch (changeType) {
            case fm.FileChangeType.Added:
                return 1; /* vscode.DeprecatedFileChangeType.Added */
            case fm.FileChangeType.Deleted:
                return 2; /* vscode.DeprecatedFileChangeType.Deleted */
            case fm.FileChangeType.Updated:
                return 0; /* vscode.FileChangeType.Updated */
            default: throw new Error('changeType not supported');
        }
    }
    dispose() {
        this.workspaceService.dispose();
        this.fileService.dispose();
    }
    utimes(resource, mtime, atime) {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.resolve(undefined);
        });
    }
    stat(resource) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                return this.getDefaultFileStat(resource);
            }
            if (resource.path === '/' || resource.path === '') {
                return Promise.resolve({
                    type: 1,
                    id: resource.toString(),
                    mtime: 0,
                    size: 0
                });
            }
            let fileListOptions = {
                recurseMode: fm.FileRecurseMode.None,
                excludePatterns: undefined,
                includeDetails: true
            };
            let paths = [];
            paths.push(resource.path);
            return this.fileService.listAsync(paths, fileListOptions)
                .then((fileInfo) => {
                return this.getFileStat(fileInfo[0], resource.toString());
            });
        });
    }
    read(resource, offset = 0, length, progress) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive || !resource.path.length) {
                return Promise.resolve(0);
            }
            let fileTextInfo;
            try {
                fileTextInfo = yield this.fileService.readTextAsync(resource.path, {});
            }
            catch (e) {
                // throw a friendlier error
                throw new Error('Please wait to open workspace files until the collaboration session is joined.');
            }
            if (fileTextInfo.exists === false) {
                // It's possible the file was deleted or excluded since the last directory-list call
                // and the change notification hasn't been processed yet.
                // TODO: Throw a specific Error in this case after VS Code supports error-handling
                // for FS provider calls. See related VS Code issue:
                // https://github.com/Microsoft/vscode/issues/47475
                // For now, just pretend the file is empty.
                return Promise.resolve(0);
            }
            // The file we received from the file service is not guaranteed to be completely synchronized with coauthoring.
            // Wait for the coauthoring client to fully synchronize it.
            let content = fileTextInfo.text;
            const coAuthoringFileName = session_1.SessionContext.coeditingClient.uriToFileName(resource);
            if (coAuthoringFileName) {
                content = yield session_1.SessionContext.coeditingClient.performFileOpenHandshake(coAuthoringFileName, content);
            }
            let fileBuffer = buffer.Buffer.from(content, 'utf8');
            if (offset >= fileBuffer.length) {
                return Promise.resolve(0);
            }
            else {
                // length is -1 if the IDE needs the whole file, so only handle positive lengths
                let actualBuffer = fileBuffer.subarray(offset, length > 0 ? offset + length : undefined);
                progress.report(actualBuffer);
                return Promise.resolve(actualBuffer.length);
            }
        });
    }
    write(resource, content) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                return Promise.resolve(void 0);
            }
            // First check if the file exists
            return this.fileExists(resource)
                .then((exists) => {
                if (exists) {
                    // The co-editing client takes care of sending a save request to the owner, so there is nothing to do here.
                    return Promise.resolve(void 0);
                }
                else {
                    // The participant is creating a new file
                    let stringContent = content.toString();
                    return this.fileService.writeTextAsync(resource.path, stringContent, { append: false, createIfNotExist: true });
                }
            })
                .catch((e) => {
                // To prevent dirty files and the "Save before closing?" dialog, report a save success.
                return Promise.resolve(void 0);
            });
        });
    }
    move(resource, target) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                return this.getDefaultFileStat(target);
            }
            let fileInfo = yield this.fileService.moveAsync(resource.path, url.parse(target.path).path, { overwrite: false });
            vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            return this.getFileStat(fileInfo, target.toString());
        });
    }
    mkdir(resource) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                return this.getDefaultFileStat(resource);
            }
            let fileInfo = yield this.fileService.createDirectoryAsync(resource.path);
            return this.getFileStat(fileInfo, resource.toString());
        });
    }
    readdir(resource) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = [];
            if (!this.isSessionActive) {
                return result;
            }
            let fileListOptions = {
                recurseMode: fm.FileRecurseMode.Children,
                excludePatterns: undefined,
                includeDetails: true
            };
            let fileInfo;
            if (resource.path === '/' || resource.path === '') {
                fileInfo = yield this.fileService.listRootsAsync(fileListOptions);
                if (fileInfo.length === 1) {
                    fileInfo = fileInfo[0].children;
                }
            }
            else {
                fileInfo = yield this.fileService.listAsync([resource.path], fileListOptions);
                fileInfo = fileInfo[0].children;
            }
            if (fileInfo) {
                fileInfo.forEach(fi => {
                    let uri = resource.with({ path: fi.path });
                    let fileStat = this.getFileStat(fi, uri.toString());
                    result.push([uri, fileStat]);
                });
            }
            return result;
        });
    }
    rmdir(resource) {
        if (!this.isSessionActive) {
            return Promise.resolve(void 0);
        }
        return this.fileService.deleteAsync(resource.path, { useTrash: true });
    }
    unlink(resource) {
        if (!this.isSessionActive) {
            return Promise.resolve(void 0);
        }
        return this.fileService.deleteAsync(resource.path, { useTrash: true });
    }
    get isSessionActive() {
        const isJoined = (session_1.SessionContext.State === session_1.SessionState.Joined);
        const isConnected = (this.currentConnectionStatus !== wm.WorkspaceConnectionStatus.Disconnected);
        return isJoined && isConnected;
    }
    getDefaultFileStat(resource) {
        return Promise.resolve({
            type: 1 /* vscode.FileType.Dir */,
            id: resource.toString(),
            mtime: 0,
            size: 0
        });
    }
    fileExists(resource) {
        let fileListOptions = {
            recurseMode: fm.FileRecurseMode.None,
            excludePatterns: undefined,
            includeDetails: true
        };
        let paths = [];
        paths.push(resource.path);
        return this.fileService.listAsync(paths, fileListOptions)
            .then((fileInfo) => {
            // exits is only populated with false if the file does not exist
            return fileInfo[0].exists !== false;
        });
    }
}
exports.DeprecatedWorkspaceProvider = DeprecatedWorkspaceProvider;

//# sourceMappingURL=workspaceProvider.js.map
