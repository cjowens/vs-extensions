"use strict";
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const uuid = require("uuid");
const vscode = require("vscode");
const config = require("../config");
const util_1 = require("../util");
/** Provides converters from vscode Uri to LSP protocol paths and back.
 *  Also manages paths for documents external to the shared workspace.
 */
class PathManager {
    constructor() {
        this.externalUriToIds = new Map();
        this.externalIdToUris = new Map();
        this.scheme = `${config.get(config.Key.scheme)}:`;
    }
    /**
     * Given a generated external uri string get the original Uri
     */
    getOriginalUri(externalUri) {
        // The value we get may not be fully %-encoded. Since the values we have as keys are %-encoded
        // create a uri and get it's %-encoded value.
        let encodedValue = vscode.Uri.parse(externalUri).toString().toLowerCase();
        if (!this.externalIdToUris.has(encodedValue)) {
            throw new Error('Unknown document id');
        }
        return this.externalIdToUris.get(encodedValue);
    }
    /**
     * Convert from the host paths to a vsls URI which looks like (vsls:/<relative path from workspace root>) with forward slashes.
     */
    code2ProtocolUriConverter(value) {
        if (!value) {
            return undefined;
        }
        // If we have a http\https uri, pass them through because operations on those should happen on the client side.
        if (value.scheme.toLowerCase() === 'http' || value.scheme.toLowerCase() === 'https') {
            return value.toString();
        }
        // If the given uri is outside of the workspace, workspaceFolder will be undefined.
        let workspaceFolder = vscode.workspace.getWorkspaceFolder(value);
        if (workspaceFolder) {
            return util_1.PathUtil.convertToForwardSlashes(util_1.PathUtil.replacePathWithScheme(value.fsPath, workspaceFolder.uri.fsPath));
        }
        else {
            let uriString = value.toString();
            if (this.externalUriToIds.has(uriString)) {
                return this.externalUriToIds.get(uriString);
            }
            let fileName = path.basename(value.fsPath);
            let guid = uuid().replace(/-/g, '');
            // Create a URI and call toString so that it gets %-encoded. Other parts of the system will %-encode the string.
            let externalUri = vscode.Uri.parse(`${PathManager.vslsExternalScheme}:/${guid}/${fileName}`).toString().toLowerCase();
            this.externalUriToIds.set(uriString, externalUri);
            this.externalIdToUris.set(externalUri, value);
            return externalUri;
        }
    }
    /**
     * Convert from a protocol path which is a vsls uri to local paths.
     */
    protocol2CodeUriConverter(value) {
        if (!value) {
            return undefined;
        }
        if (value.startsWith(this.scheme)) {
            // TODO: vscode.workspace.rootPath returns the first root. When we support multi-root
            // workspaces, we need to encode the root in the vsls uris as well.
            return vscode.Uri.file(util_1.PathUtil.replaceSchemeWithPath(value, vscode.workspace.rootPath));
        }
        else if (value.startsWith(`${PathManager.vslsExternalScheme}:/`)) {
            return this.getOriginalUri(value);
        }
        else if (value.toLowerCase().startsWith('http') || value.toLowerCase().startsWith('https')) {
            return vscode.Uri.parse(value);
        }
        else {
            throw new Error('Unknown path format from the client');
        }
    }
    dispose() {
        this.externalIdToUris.clear();
        this.externalUriToIds.clear();
    }
}
PathManager.vslsExternalScheme = 'vslsexternal';
exports.PathManager = PathManager;

//# sourceMappingURL=pathManager.js.map
