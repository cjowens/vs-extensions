"use strict";
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const vscode_languageclient_1 = require("vscode-languageclient");
exports.ShowOnlineHelpRequestType = new vscode_languageclient_1.RequestType("powerShell/showOnlineHelp");
class ShowHelpFeature {
    constructor() {
        this.command = vscode.commands.registerCommand("PowerShell.OnlineHelp", () => {
            if (this.languageClient === undefined) {
                // TODO: Log error message
                return;
            }
            const editor = vscode.window.activeTextEditor;
            const selection = editor.selection;
            const doc = editor.document;
            const cwr = doc.getWordRangeAtPosition(selection.active);
            const text = doc.getText(cwr);
            this.languageClient.sendRequest(exports.ShowOnlineHelpRequestType, text);
        });
    }
    dispose() {
        this.command.dispose();
    }
    setLanguageClient(languageclient) {
        this.languageClient = languageclient;
    }
}
exports.ShowHelpFeature = ShowHelpFeature;
//# sourceMappingURL=ShowOnlineHelp.js.map