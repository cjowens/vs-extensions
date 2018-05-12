"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
const vscode = require("vscode");
const path = require("path");
const url = require("url");
const config = require("../config");
class ExpertPathConverter {
    /**
     * TODO HACK: make this work in a workspace with N folders
     */
    uriToFileName(uri) {
        if (uri.scheme !== config.get(config.Key.scheme)) {
            return null;
        }
        return uri.path;
    }
    /**
     * TODO HACK: make this work in a workspace with N folders
     */
    fileNameToUri(fileName) {
        return vscode.Uri.parse(`${config.get(config.Key.scheme)}:${fileName}`);
    }
}
exports.ExpertPathConverter = ExpertPathConverter;
class OwnerPathConverter {
    /**
     * TODO HACK: make this work in a workspace with N folders
     */
    uriToFileName(uri) {
        if (uri.scheme !== 'file') {
            return null;
        }
        const fsPath = uri.fsPath;
        const rootPath = vscode.workspace.rootPath;
        if (fsPath.indexOf(rootPath) !== 0) {
            return null;
        }
        const remaining = fsPath.substr(rootPath.length);
        // Encode and decode the remaining path as URL to normalize slashes
        const parsed = url.parse(remaining);
        let decodedURI = decodeURI(parsed.href);
        // VSCode triggers all remote file events with leading slash,
        // adding slash for consistency
        if (!decodedURI.startsWith('/')) {
            decodedURI = '/' + decodedURI;
        }
        return decodedURI;
    }
    /**
     * TODO HACK: make this work in a workspace with N folders
     */
    fileNameToUri(fileName) {
        const filePath = path.join(vscode.workspace.rootPath, fileName);
        return vscode.Uri.file(filePath);
    }
}
exports.OwnerPathConverter = OwnerPathConverter;

//# sourceMappingURL=pathConverter.js.map
