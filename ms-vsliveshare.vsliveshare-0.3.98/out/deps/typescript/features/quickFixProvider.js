"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const convert_1 = require("../utils/convert");
const codeAction_1 = require("../utils/codeAction");
class TypeScriptQuickFixProvider {
    constructor(client, formattingConfigurationManager) {
        this.client = client;
        this.formattingConfigurationManager = formattingConfigurationManager;
    }
    provideCodeActions(_document, _range, _context, _token) {
        // Uses provideCodeActions2 instead
        return [];
    }
    async provideCodeActions2(document, range, context, token) {
        if (!this.client.apiVersion.has213Features()) {
            return [];
        }
        const file = this.client.normalizePath(document.uri);
        if (!file) {
            return [];
        }
        const supportedActions = await this.getSupportedActionsForContext(context);
        if (!supportedActions.size) {
            return [];
        }
        await this.formattingConfigurationManager.ensureFormatOptionsForDocument(document, token);
        const args = Object.assign({}, convert_1.vsRangeToTsFileRange(file, range), { errorCodes: Array.from(supportedActions) });
        const response = await this.client.execute('getCodeFixes', args, token);
        return (response.body || []).map(action => this.getCommandForAction(action));
    }
    get supportedCodeActions() {
        if (!this._supportedCodeActions) {
            this._supportedCodeActions = this.client.execute('getSupportedCodeFixes', null, undefined)
                .then(response => response.body || [])
                .then(codes => codes.map(code => +code).filter(code => !isNaN(code)))
                .then(codes => codes.reduce((obj, code) => {
                obj[code] = true;
                return obj;
            }, Object.create(null)));
        }
        return this._supportedCodeActions;
    }
    async getSupportedActionsForContext(context) {
        const supportedActions = await this.supportedCodeActions;
        return new Set(context.diagnostics
            .map(diagnostic => +diagnostic.code)
            .filter(code => supportedActions[code]));
    }
    getCommandForAction(action) {
        return {
            title: action.description,
            edits: codeAction_1.getEditForCodeAction(this.client, action),
            diagnostics: []
        };
    }
}
exports.default = TypeScriptQuickFixProvider;

//# sourceMappingURL=quickFixProvider.js.map
