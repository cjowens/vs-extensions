"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_1 = require("vscode");
const convert_1 = require("./convert");
function getEditForCodeAction(client, action) {
    if (action.changes && action.changes.length) {
        const workspaceEdit = new vscode_1.WorkspaceEdit();
        for (const change of action.changes) {
            for (const textChange of change.textChanges) {
                workspaceEdit.replace(client.asUrl(change.fileName), convert_1.tsTextSpanToVsRange(textChange), textChange.newText);
            }
        }
        return workspaceEdit;
    }
    return undefined;
}
exports.getEditForCodeAction = getEditForCodeAction;
async function applyCodeAction(client, action) {
    const workspaceEdit = getEditForCodeAction(client, action);
    if (workspaceEdit) {
        if (!(await vscode_1.workspace.applyEdit(workspaceEdit))) {
            return false;
        }
    }
    return applyCodeActionCommands(client, action);
}
exports.applyCodeAction = applyCodeAction;
async function applyCodeActionCommands(client, action) {
    if (action.commands && action.commands.length) {
        for (const command of action.commands) {
            const response = await client.execute('applyCodeActionCommand', { command });
            if (!response || !response.body) {
                return false;
            }
        }
    }
    return true;
}
exports.applyCodeActionCommands = applyCodeActionCommands;

//# sourceMappingURL=codeAction.js.map
