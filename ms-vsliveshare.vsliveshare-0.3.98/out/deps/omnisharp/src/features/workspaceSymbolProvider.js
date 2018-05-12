/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const abstractProvider_1 = require("./abstractProvider");
const serverUtils = require("../omnisharp/utils");
const typeConvertion_1 = require("../omnisharp/typeConvertion");
const vscode_1 = require("vscode");
class OmnisharpWorkspaceSymbolProvider extends abstractProvider_1.default {
    provideWorkspaceSymbols(search, token) {
        return serverUtils.findSymbols(this._server, { Filter: search, FileName: '' }, token).then(res => {
            if (res && Array.isArray(res.QuickFixes)) {
                return res.QuickFixes.map(OmnisharpWorkspaceSymbolProvider._asSymbolInformation);
            }
        });
    }
    static _asSymbolInformation(symbolInfo) {
        return new vscode_1.SymbolInformation(symbolInfo.Text, OmnisharpWorkspaceSymbolProvider._toKind(symbolInfo), typeConvertion_1.toRange(symbolInfo), typeConvertion_1.toUri(symbolInfo.FileName));
    }
    static _toKind(symbolInfo) {
        switch (symbolInfo.Kind) {
            case 'Method':
                return vscode_1.SymbolKind.Method;
            case 'Field':
                return vscode_1.SymbolKind.Field;
            case 'Property':
                return vscode_1.SymbolKind.Property;
            case 'Interface':
                return vscode_1.SymbolKind.Interface;
            case 'Enum':
                return vscode_1.SymbolKind.Enum;
            case 'Struct':
                return vscode_1.SymbolKind.Struct;
            case 'Event':
                return vscode_1.SymbolKind.Event;
            case 'EnumMember':
                return vscode_1.SymbolKind.EnumMember;
            case 'Class':
                return vscode_1.SymbolKind.Class;
            default:
                return vscode_1.SymbolKind.Class;
        }
    }
}
exports.default = OmnisharpWorkspaceSymbolProvider;

//# sourceMappingURL=workspaceSymbolProvider.js.map
