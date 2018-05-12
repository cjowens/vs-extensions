"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const path = require("path");
const convert_1 = require("../utils/convert");
function isImplicitProjectConfigFile(configFileName) {
    return configFileName.indexOf('/dev/null/') === 0;
}
exports.isImplicitProjectConfigFile = isImplicitProjectConfigFile;
function getEmptyConfig(isTypeScriptProject, config) {
    const compilerOptions = [
        '"target": "ES6"',
        '"module": "commonjs"',
        '"jsx": "preserve"',
    ];
    if (!isTypeScriptProject && config.checkJs) {
        compilerOptions.push('"checkJs": true');
    }
    if (!isTypeScriptProject && config.experimentalDecorators) {
        compilerOptions.push('"experimentalDecorators": true');
    }
    return new vscode.SnippetString(`{
	"compilerOptions": {
		${compilerOptions.join(',\n\t\t')}$0
	},
	"exclude": [
		"node_modules",
		"**/node_modules/*"
	]
}`);
}
async function openOrCreateConfigFile(isTypeScriptProject, rootPath, config) {
    const configFile = convert_1.toUri(path.join(rootPath, isTypeScriptProject ? 'tsconfig.json' : 'jsconfig.json'));
    const col = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
    try {
        const doc = await vscode.workspace.openTextDocument(configFile);
        return vscode.window.showTextDocument(doc, col);
    }
    catch (_a) {
        const doc = await vscode.workspace.openTextDocument(configFile.with({ scheme: 'untitled' }));
        const editor = await vscode.window.showTextDocument(doc, col);
        if (editor.document.getText().length === 0) {
            await editor.insertSnippet(getEmptyConfig(isTypeScriptProject, config));
        }
        return editor;
    }
}
exports.openOrCreateConfigFile = openOrCreateConfigFile;

//# sourceMappingURL=tsconfig.js.map
