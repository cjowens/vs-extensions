"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
class ReloadTypeScriptProjectsCommand {
    constructor(lazyClientHost) {
        this.lazyClientHost = lazyClientHost;
        this.id = 'typescript.reloadProjects';
    }
    execute() {
        this.lazyClientHost.value.reloadProjects();
    }
}
exports.ReloadTypeScriptProjectsCommand = ReloadTypeScriptProjectsCommand;
class ReloadJavaScriptProjectsCommand {
    constructor(lazyClientHost) {
        this.lazyClientHost = lazyClientHost;
        this.id = 'javascript.reloadProjects';
    }
    execute() {
        this.lazyClientHost.value.reloadProjects();
    }
}
exports.ReloadJavaScriptProjectsCommand = ReloadJavaScriptProjectsCommand;
class SelectTypeScriptVersionCommand {
    constructor(lazyClientHost) {
        this.lazyClientHost = lazyClientHost;
        this.id = 'typescript.selectTypeScriptVersion';
    }
    execute() {
        this.lazyClientHost.value.serviceClient.onVersionStatusClicked();
    }
}
exports.SelectTypeScriptVersionCommand = SelectTypeScriptVersionCommand;
class OpenTsServerLogCommand {
    constructor(lazyClientHost) {
        this.lazyClientHost = lazyClientHost;
        this.id = 'typescript.openTsServerLog';
    }
    execute() {
        this.lazyClientHost.value.serviceClient.openTsServerLogFile();
    }
}
exports.OpenTsServerLogCommand = OpenTsServerLogCommand;
class RestartTsServerCommand {
    constructor(lazyClientHost) {
        this.lazyClientHost = lazyClientHost;
        this.id = 'typescript.restartTsServer';
    }
    execute() {
        this.lazyClientHost.value.serviceClient.restartTsServer();
    }
}
exports.RestartTsServerCommand = RestartTsServerCommand;
class TypeScriptGoToProjectConfigCommand {
    constructor(lazyClientHost) {
        this.lazyClientHost = lazyClientHost;
        this.id = 'typescript.goToProjectConfig';
    }
    execute() {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            this.lazyClientHost.value.goToProjectConfig(true, editor.document.uri);
        }
    }
}
exports.TypeScriptGoToProjectConfigCommand = TypeScriptGoToProjectConfigCommand;
class JavaScriptGoToProjectConfigCommand {
    constructor(lazyClientHost) {
        this.lazyClientHost = lazyClientHost;
        this.id = 'javascript.goToProjectConfig';
    }
    execute() {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            this.lazyClientHost.value.goToProjectConfig(false, editor.document.uri);
        }
    }
}
exports.JavaScriptGoToProjectConfigCommand = JavaScriptGoToProjectConfigCommand;

//# sourceMappingURL=commands.js.map
