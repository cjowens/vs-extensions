//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
//
// Entrypoint and type definitions for Live Share for VS Code extension API
//
const path = require("path");
const vscode = require("vscode");
/**
 * Entrypoint for access to the Live Share API.
 *
 * @returns an instance of the Live Share API, or null if the Live Share extension
 * is not installed or failed to activate.
 *
 * @example To access the Live Share API from another extension:
 *
 *     import * as vsls from 'vsliveshare-api';
 *     const liveshare = await vsls.getApiAsync(extensionContext);
 */
function getApiAsync(currentExtensionContext) {
    let liveshareExtension = vscode.extensions.getExtension('ms-vsliveshare.vsliveshare');
    if (liveshareExtension) {
        return liveshareExtension.activate().then((extensionApi) => {
            if (extensionApi) {
                const liveShareApiVersion = require(path.join(__dirname, 'package.json')).version;
                return extensionApi.getApiAsync(currentExtensionContext, liveShareApiVersion);
            }
            else {
                return null;
            }
        });
    }
    return Promise.resolve(null);
}
exports.getApiAsync = getApiAsync;
var Role;
(function (Role) {
    Role[Role["None"] = 0] = "None";
    Role[Role["Host"] = 1] = "Host";
    Role[Role["Guest"] = 2] = "Guest";
})(Role = exports.Role || (exports.Role = {}));
/** This is just a placeholder for a richer access control model to be added later. */
var Access;
(function (Access) {
    Access[Access["None"] = 0] = "None";
    Access[Access["ReadOnly"] = 1] = "ReadOnly";
    Access[Access["ReadWrite"] = 3] = "ReadWrite";
    Access[Access["Owner"] = 255] = "Owner";
})(Access = exports.Access || (exports.Access = {}));

//# sourceMappingURL=LiveShare.js.map
