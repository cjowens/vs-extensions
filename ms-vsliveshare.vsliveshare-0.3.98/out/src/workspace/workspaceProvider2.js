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
const path = require("path");
const buffer = require("buffer");
const traceSource_1 = require("../tracing/traceSource");
const wm = require("./contract/WorkspaceServiceTypes");
const fm = require("./contract/FileServiceTypes");
const service_1 = require("./service");
const url = require("url");
const session_1 = require("../session");
const config = require("../config");
class WorkspaceProvider {
    constructor(workspaceService, fileService, cmnds, root) {
        this.workspaceService = workspaceService;
        this.fileService = fileService;
        this.cmnds = cmnds;
        this.root = root;
        this._version = 8; // tslint:disable-line
        this.onFilesChangedEmitter = new vscode.EventEmitter();
        /**
         * An event to signal that a resource has been created, changed, or deleted. This
         * event should fire for resources that are being [watched](#FileSystemProvider2.watch)
         * by clients of this provider.
         */
        this.onDidChangeFile = this.onFilesChangedEmitter.event;
        this.getFileStat = (fileInfo, id) => {
            let fileStat = {
                mtime: Date.parse(fileInfo.mtime),
                ctime: Date.parse(fileInfo.mtime),
                size: fileInfo.size ? fileInfo.size : 0,
                type: fileInfo.isDirectory ? vscode.FileType.Directory : vscode.FileType.File
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
                type: WorkspaceProvider.toFileChangeType(change.changeType),
                uri: vscode.Uri.parse(config.get(config.Key.scheme) + ':/' + change.path)
            };
            return fileChange;
        });
        this.onFilesChangedEmitter.fire(changes);
    }
    static toFileChangeType(changeType) {
        switch (changeType) {
            case fm.FileChangeType.Added:
                return vscode.FileChangeType.Created;
            case fm.FileChangeType.Deleted:
                return vscode.FileChangeType.Deleted;
            case fm.FileChangeType.Updated:
                return vscode.FileChangeType.Changed;
            default: throw new Error('changeType not supported');
        }
    }
    dispose() {
        this.workspaceService.dispose();
        this.fileService.dispose();
    }
    /**
     * Subscribe to events in the file or folder denoted by `uri`.
     * @param uri
     * @param options
     */
    watch(uri, options) {
        return {
            dispose() {
                /* TODO: @Daniel, implement proper file watching once we have support in the Agent */
                /* Right now we fire onDidChangeFile for every file change */
                /* empty */
            }
        };
    }
    /**
     * Retrieve metadata about a file.
     *
     * @param uri The uri of the file to retrieve meta data about.
     * @return The file metadata about the file.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist.
     */
    stat(resource) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                return this.getDefaultFileStat(resource);
            }
            if (resource.path === '/' || resource.path === '') {
                return Promise.resolve({
                    type: vscode.FileType.Directory,
                    ctime: 0,
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
    /**
     * Read the entire contents of a file.
     *
     * @param uri The uri of the file.
     * @return An array of bytes or a thenable that resolves to such.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist.
     */
    readFile(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive || !uri.path.length) {
                throw vscode.FileSystemError.FileNotFound;
            }
            let fileTextInfo;
            try {
                fileTextInfo = yield this.fileService.readTextAsync(uri.path, {});
            }
            catch (e) {
                // throw a friendlier error
                throw new Error('Please wait to open workspace files until the collaboration session is joined.');
            }
            // The file we received from the file service is not guaranteed to be completely synchronized with coauthoring.
            // Wait for the coauthoring client to fully synchronize it.
            let content = fileTextInfo.text;
            const coAuthoringFileName = session_1.SessionContext.coeditingClient.uriToFileName(uri);
            if (coAuthoringFileName) {
                content = yield session_1.SessionContext.coeditingClient.performFileOpenHandshake(coAuthoringFileName, content);
            }
            let fileBuffer = buffer.Buffer.from(content, 'utf8');
            return Promise.resolve(fileBuffer);
        });
    }
    /**
     * Write data to a file, replacing its entire contents.
     *
     * @param uri The uri of the file.
     * @param content The new content of the file.
     * @param options Defines is missing files should or must be created.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist and `create` is not set.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when the parent of `uri` doesn't exist and `create` is set.
     * @throws [`FileExists`](#FileSystemError.FileExists) when `uri` already exists and `overwrite` is set.
     * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
     */
    writeFile(uri, content, options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                throw vscode.FileSystemError.FileNotFound;
            }
            // First check if the file exists
            return this.fileExists(uri)
                .then((exists) => {
                if (exists) {
                    // The co-editing client takes care of sending a save request to the owner, so there is nothing to do here.
                    return Promise.resolve(void 0);
                }
                else {
                    // The participant is creating a new file
                    let stringContent = content.toString();
                    return this.fileService.writeTextAsync(uri.path, stringContent, { append: false, createIfNotExist: true });
                }
            })
                .catch((e) => {
                // To prevent dirty files and the "Save before closing?" dialog, report a save success.
                return Promise.resolve(void 0);
            });
        });
    }
    /**
     * Rename a file or folder.
     *
     * @param oldUri The existing file or folder.
     * @param newUri The target location.
     * @param options Defines if existing files should be overwriten.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `oldUri` doesn't exist.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when parent of `newUri` doesn't exist
     * @throws [`FileExists`](#FileSystemError.FileExists) when `newUri` exists and when the `overwrite` option is not `true`.
     * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
     */
    rename(oldUri, newUri, options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                throw vscode.FileSystemError.FileNotFound;
            }
            yield this.fileService.moveAsync(oldUri.path, url.parse(newUri.path).path, { overwrite: false });
        });
    }
    /**
     * Create a new directory. *Note* that new files are created via `write`-calls.
     *
     * @param uri The uri of the new folder.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when the parent of `uri` doesn't exist.
     * @throws [`FileExists`](#FileSystemError.FileExists) when `uri` already exists.
     * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
     */
    createDirectory(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                throw vscode.FileSystemError.FileNotFound;
            }
            yield this.fileService.createDirectoryAsync(uri.path);
        });
    }
    /**
     * Retrieve the meta data of all entries of a [directory](#FileType.Directory)
     *
     * @param uri The uri of the folder.
     * @return An array of name/type-tuples or a thenable that resolves to such.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist.
     */
    readDirectory(uri) {
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
            if (uri.path === '/' || uri.path === '') {
                fileInfo = yield this.fileService.listRootsAsync(fileListOptions);
                if (fileInfo.length === 1) {
                    fileInfo = fileInfo[0].children;
                }
            }
            else {
                fileInfo = yield this.fileService.listAsync([uri.path], fileListOptions);
                fileInfo = fileInfo[0].children;
            }
            if (fileInfo) {
                fileInfo.forEach(fi => {
                    let fileUri = uri.with({ path: fi.path });
                    let fileStat = this.getFileStat(fi, fileUri.toString());
                    let fileName = path.basename(fi.path);
                    result.push([fileName, fileStat.type]);
                });
            }
            return result;
        });
    }
    /**
     * Delete a file.
     *
     * @param uri The resource that is to be deleted.
     * @param options Defines if deletion of folders is recursive.
     * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist.
     * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
     */
    delete(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSessionActive) {
                throw vscode.FileSystemError.FileNotFound;
            }
            return this.fileService.deleteAsync(uri.path, { useTrash: true });
        });
    }
    get isSessionActive() {
        const isJoined = (session_1.SessionContext.State === session_1.SessionState.Joined);
        const isConnected = (this.currentConnectionStatus !== wm.WorkspaceConnectionStatus.Disconnected);
        return isJoined && isConnected;
    }
    getDefaultFileStat(resource) {
        return Promise.resolve({
            type: vscode.FileType.Directory,
            mtime: 0,
            ctime: 0,
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
exports.WorkspaceProvider = WorkspaceProvider;

//# sourceMappingURL=workspaceProvider2.js.map
