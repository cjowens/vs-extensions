"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
/* --------------------------------------------------------------------------------------------
 * Includes code from typescript-sublime-plugin project, obtained from
 * https://github.com/Microsoft/TypeScript-Sublime-Plugin/blob/master/TypeScript%20Indent.tmPreferences
 * ------------------------------------------------------------------------------------------ */
const vscode_1 = require("vscode");
// This must be the first statement otherwise modules might got loaded with
// the wrong locale.
const nls = require("vscode-nls");
nls.config({ locale: vscode_1.env.language });
const localize = nls.loadMessageBundle();
const path_1 = require("path");
const PConst = require("./protocol.const");
const typescriptServiceClient_1 = require("./typescriptServiceClient");
const bufferSyncSupport_1 = require("./features/bufferSyncSupport");
const typingsStatus_1 = require("./utils/typingsStatus");
const versionStatus_1 = require("./utils/versionStatus");
const tsconfig_1 = require("./utils/tsconfig");
const convert_1 = require("./utils/convert");
const formattingConfigurationManager_1 = require("./features/formattingConfigurationManager");
const languageConfigurations = require("./utils/languageConfigurations");
const diagnostics_1 = require("./features/diagnostics");
const validateSetting = 'validate.enable';
class LanguageProvider {
    constructor(client, description, commandManager, typingsStatus) {
        this.client = client;
        this.description = description;
        this.toUpdateOnConfigurationChanged = [];
        this._validate = true;
        this.disposables = [];
        this.versionDependentDisposables = [];
        this.formattingOptionsManager = new formattingConfigurationManager_1.default(client);
        this.bufferSyncSupport = new bufferSyncSupport_1.default(client, description.modeIds, {
            delete: (file) => {
                this.diagnosticsManager.delete(file);
            }
        }, this._validate);
        this.diagnosticsManager = new diagnostics_1.default(description.id, this.client);
        vscode_1.workspace.onDidChangeConfiguration(this.configurationChanged, this, this.disposables);
        this.configurationChanged();
        client.onReady().then(async () => {
            await this.registerProviders(client, commandManager, typingsStatus);
            this.bufferSyncSupport.listen();
        }, () => {
            // Nothing to do here. The client did show a message;
        });
    }
    dispose() {
        while (this.disposables.length) {
            const obj = this.disposables.pop();
            if (obj) {
                obj.dispose();
            }
        }
        while (this.versionDependentDisposables.length) {
            const obj = this.versionDependentDisposables.pop();
            if (obj) {
                obj.dispose();
            }
        }
        this.diagnosticsManager.dispose();
        this.bufferSyncSupport.dispose();
        this.formattingOptionsManager.dispose();
    }
    get documentSelector() {
        if (!this._documentSelector) {
            this._documentSelector = [];
            for (const language of this.description.modeIds) {
                this._documentSelector.push({ language, scheme: 'vsls' });
            }
        }
        return this._documentSelector;
    }
    async registerProviders(client, commandManager, typingsStatus) {
        const selector = this.documentSelector;
        const config = vscode_1.workspace.getConfiguration(this.id);
        this.disposables.push(vscode_1.languages.registerCompletionItemProvider(selector, new (await Promise.resolve().then(() => require('./features/completionItemProvider'))).default(client, typingsStatus, commandManager), '.', '"', '\'', '/', '@'));
        this.disposables.push(vscode_1.languages.registerCompletionItemProvider(selector, new (await Promise.resolve().then(() => require('./features/directiveCommentCompletionProvider'))).default(client), '@'));
        const { TypeScriptFormattingProvider, FormattingProviderManager } = await Promise.resolve().then(() => require('./features/formattingProvider'));
        const formattingProvider = new TypeScriptFormattingProvider(client, this.formattingOptionsManager);
        formattingProvider.updateConfiguration(config);
        this.disposables.push(vscode_1.languages.registerOnTypeFormattingEditProvider(selector, formattingProvider, ';', '}', '\n'));
        const formattingProviderManager = new FormattingProviderManager(this.description.id, formattingProvider, selector);
        formattingProviderManager.updateConfiguration();
        this.disposables.push(formattingProviderManager);
        this.toUpdateOnConfigurationChanged.push(formattingProviderManager);
        this.disposables.push(vscode_1.languages.registerCompletionItemProvider(selector, new (await Promise.resolve().then(() => require('./features/jsDocCompletionProvider'))).default(client, commandManager), '*'));
        this.disposables.push(vscode_1.languages.registerHoverProvider(selector, new (await Promise.resolve().then(() => require('./features/hoverProvider'))).default(client)));
        this.disposables.push(vscode_1.languages.registerDefinitionProvider(selector, new (await Promise.resolve().then(() => require('./features/definitionProvider'))).default(client)));
        this.disposables.push(vscode_1.languages.registerDocumentHighlightProvider(selector, new (await Promise.resolve().then(() => require('./features/documentHighlightProvider'))).default(client)));
        this.disposables.push(vscode_1.languages.registerReferenceProvider(selector, new (await Promise.resolve().then(() => require('./features/referenceProvider'))).default(client)));
        this.disposables.push(vscode_1.languages.registerDocumentSymbolProvider(selector, new (await Promise.resolve().then(() => require('./features/documentSymbolProvider'))).default(client)));
        this.disposables.push(vscode_1.languages.registerSignatureHelpProvider(selector, new (await Promise.resolve().then(() => require('./features/signatureHelpProvider'))).default(client), '(', ','));
        this.disposables.push(vscode_1.languages.registerRenameProvider(selector, new (await Promise.resolve().then(() => require('./features/renameProvider'))).default(client)));
        this.disposables.push(vscode_1.languages.registerCodeActionsProvider(selector, new (await Promise.resolve().then(() => require('./features/quickFixProvider'))).default(client, this.formattingOptionsManager)));
        this.disposables.push(vscode_1.languages.registerCodeActionsProvider(selector, new (await Promise.resolve().then(() => require('./features/refactorProvider'))).default(client, this.formattingOptionsManager, commandManager)));
        this.registerVersionDependentProviders();
        const referenceCodeLensProvider = new (await Promise.resolve().then(() => require('./features/referencesCodeLensProvider'))).default(client, this.description.id);
        referenceCodeLensProvider.updateConfiguration();
        this.toUpdateOnConfigurationChanged.push(referenceCodeLensProvider);
        this.disposables.push(vscode_1.languages.registerCodeLensProvider(selector, referenceCodeLensProvider));
        const implementationCodeLensProvider = new (await Promise.resolve().then(() => require('./features/implementationsCodeLensProvider'))).default(client, this.description.id);
        implementationCodeLensProvider.updateConfiguration();
        this.toUpdateOnConfigurationChanged.push(implementationCodeLensProvider);
        this.disposables.push(vscode_1.languages.registerCodeLensProvider(selector, implementationCodeLensProvider));
        this.disposables.push(vscode_1.languages.registerWorkspaceSymbolProvider(new (await Promise.resolve().then(() => require('./features/workspaceSymbolProvider'))).default(client, this.description.modeIds)));
        if (!this.description.isExternal) {
            for (const modeId of this.description.modeIds) {
                this.disposables.push(vscode_1.languages.setLanguageConfiguration(modeId, languageConfigurations.jsTsLanguageConfiguration));
            }
        }
    }
    configurationChanged() {
        const config = vscode_1.workspace.getConfiguration(this.id);
        this.updateValidate(config.get(validateSetting, true));
        for (const toUpdate of this.toUpdateOnConfigurationChanged) {
            toUpdate.updateConfiguration();
        }
    }
    handles(file, doc) {
        if (doc && this.description.modeIds.indexOf(doc.languageId) >= 0) {
            return true;
        }
        if (this.bufferSyncSupport.handles(file)) {
            return true;
        }
        const base = path_1.basename(file);
        return !!base && base === this.description.configFile;
    }
    get id() {
        return this.description.id;
    }
    get diagnosticSource() {
        return this.description.diagnosticSource;
    }
    updateValidate(value) {
        if (this._validate === value) {
            return;
        }
        this._validate = value;
        this.bufferSyncSupport.validate = value;
        this.diagnosticsManager.validate = value;
        if (value) {
            this.triggerAllDiagnostics();
        }
    }
    reInitialize() {
        this.diagnosticsManager.reInitialize();
        this.bufferSyncSupport.reOpenDocuments();
        this.bufferSyncSupport.requestAllDiagnostics();
        this.formattingOptionsManager.reset();
        this.registerVersionDependentProviders();
    }
    async registerVersionDependentProviders() {
        while (this.versionDependentDisposables.length) {
            const obj = this.versionDependentDisposables.pop();
            if (obj) {
                obj.dispose();
            }
        }
        if (!this.client) {
            return;
        }
        const selector = this.documentSelector;
        if (this.client.apiVersion.has220Features()) {
            this.versionDependentDisposables.push(vscode_1.languages.registerImplementationProvider(selector, new (await Promise.resolve().then(() => require('./features/implementationProvider'))).default(this.client)));
        }
        if (this.client.apiVersion.has213Features()) {
            this.versionDependentDisposables.push(vscode_1.languages.registerTypeDefinitionProvider(selector, new (await Promise.resolve().then(() => require('./features/typeDefinitionProvider'))).default(this.client)));
        }
    }
    triggerAllDiagnostics() {
        this.bufferSyncSupport.requestAllDiagnostics();
    }
    syntaxDiagnosticsReceived(file, syntaxDiagnostics) {
        this.diagnosticsManager.syntaxDiagnosticsReceived(file, syntaxDiagnostics);
    }
    semanticDiagnosticsReceived(file, semanticDiagnostics) {
        this.diagnosticsManager.semanticDiagnosticsReceived(file, semanticDiagnostics);
    }
    configFileDiagnosticsReceived(file, diagnostics) {
        this.diagnosticsManager.configFileDiagnosticsReceived(file, diagnostics);
    }
}
// Style check diagnostics that can be reported as warnings
const styleCheckDiagnostics = [
    6133,
    6138,
    7027,
    7028,
    7029,
    7030 // not all code paths return a value
];
class TypeScriptServiceClientHost {
    constructor(descriptions, workspaceState, plugins, commandManager, remoteManager) {
        this.commandManager = commandManager;
        this.languages = [];
        this.languagePerId = new Map();
        this.disposables = [];
        this.reportStyleCheckAsWarnings = true;
        const handleProjectCreateOrDelete = () => {
            this.client.execute('reloadProjects', null, false);
            this.triggerAllDiagnostics();
        };
        const handleProjectChange = () => {
            setTimeout(() => {
                this.triggerAllDiagnostics();
            }, 1500);
        };
        const configFileWatcher = vscode_1.workspace.createFileSystemWatcher('**/[tj]sconfig.json');
        this.disposables.push(configFileWatcher);
        configFileWatcher.onDidCreate(handleProjectCreateOrDelete, this, this.disposables);
        configFileWatcher.onDidDelete(handleProjectCreateOrDelete, this, this.disposables);
        configFileWatcher.onDidChange(handleProjectChange, this, this.disposables);
        this.client = new typescriptServiceClient_1.default(this, workspaceState, version => this.versionStatus.onDidChangeTypeScriptVersion(version), plugins, remoteManager);
        this.disposables.push(this.client);
        this.versionStatus = new versionStatus_1.default(resource => this.client.normalizePath(resource));
        this.disposables.push(this.versionStatus);
        this.typingsStatus = new typingsStatus_1.default(this.client);
        this.ataProgressReporter = new typingsStatus_1.AtaProgressReporter(this.client);
        for (const description of descriptions) {
            const manager = new LanguageProvider(this.client, description, this.commandManager, this.typingsStatus);
            this.languages.push(manager);
            this.disposables.push(manager);
            this.languagePerId.set(description.id, manager);
        }
        this.client.startService();
        this.client.onReady().then(() => {
            if (!this.client.apiVersion.has230Features()) {
                return;
            }
            const languages = new Set();
            for (const plugin of plugins) {
                for (const language of plugin.languages) {
                    languages.add(language);
                }
            }
            if (languages.size) {
                const description = {
                    id: 'typescript-plugins',
                    modeIds: Array.from(languages.values()),
                    diagnosticSource: 'ts-plugins',
                    isExternal: true
                };
                const manager = new LanguageProvider(this.client, description, this.commandManager, this.typingsStatus);
                this.languages.push(manager);
                this.disposables.push(manager);
                this.languagePerId.set(description.id, manager);
            }
        });
        this.client.onTsServerStarted(() => {
            this.triggerAllDiagnostics();
        });
        vscode_1.workspace.onDidChangeConfiguration(this.configurationChanged, this, this.disposables);
        this.configurationChanged();
    }
    dispose() {
        while (this.disposables.length) {
            const obj = this.disposables.pop();
            if (obj) {
                obj.dispose();
            }
        }
        this.typingsStatus.dispose();
        this.ataProgressReporter.dispose();
    }
    get serviceClient() {
        return this.client;
    }
    reloadProjects() {
        this.client.execute('reloadProjects', null, false);
        this.triggerAllDiagnostics();
    }
    handles(file) {
        return !!this.findLanguage(file);
    }
    async goToProjectConfig(isTypeScriptProject, resource) {
        const rootPath = this.client.getWorkspaceRootForResource(resource);
        if (!rootPath) {
            vscode_1.window.showInformationMessage(localize('typescript.projectConfigNoWorkspace', 'Please open a folder in VS Code to use a TypeScript or JavaScript project'));
            return;
        }
        const file = this.client.normalizePath(resource);
        // TSServer errors when 'projectInfo' is invoked on a non js/ts file
        if (!file || !this.handles(file)) {
            vscode_1.window.showWarningMessage(localize('typescript.projectConfigUnsupportedFile', 'Could not determine TypeScript or JavaScript project. Unsupported file type'));
            return;
        }
        let res = undefined;
        try {
            res = await this.client.execute('projectInfo', { file, needFileNameList: false });
        }
        catch (_a) {
            // noop
        }
        if (!res || !res.body) {
            vscode_1.window.showWarningMessage(localize('typescript.projectConfigCouldNotGetInfo', 'Could not determine TypeScript or JavaScript project'));
            return;
        }
        const { configFileName } = res.body;
        if (configFileName && !tsconfig_1.isImplicitProjectConfigFile(configFileName)) {
            const doc = await vscode_1.workspace.openTextDocument(configFileName);
            vscode_1.window.showTextDocument(doc, vscode_1.window.activeTextEditor ? vscode_1.window.activeTextEditor.viewColumn : undefined);
            return;
        }
        let ProjectConfigAction;
        (function (ProjectConfigAction) {
            ProjectConfigAction[ProjectConfigAction["None"] = 0] = "None";
            ProjectConfigAction[ProjectConfigAction["CreateConfig"] = 1] = "CreateConfig";
            ProjectConfigAction[ProjectConfigAction["LearnMore"] = 2] = "LearnMore";
        })(ProjectConfigAction || (ProjectConfigAction = {}));
        const selected = await vscode_1.window.showInformationMessage((isTypeScriptProject
            ? localize('typescript.noTypeScriptProjectConfig', 'File is not part of a TypeScript project')
            : localize('typescript.noJavaScriptProjectConfig', 'File is not part of a JavaScript project')), {
            title: isTypeScriptProject
                ? localize('typescript.configureTsconfigQuickPick', 'Configure tsconfig.json')
                : localize('typescript.configureJsconfigQuickPick', 'Configure jsconfig.json'),
            id: ProjectConfigAction.CreateConfig
        }, {
            title: localize('typescript.projectConfigLearnMore', 'Learn More'),
            id: ProjectConfigAction.LearnMore
        });
        switch (selected && selected.id) {
            case ProjectConfigAction.CreateConfig:
                tsconfig_1.openOrCreateConfigFile(isTypeScriptProject, rootPath, this.client.configuration);
                return;
            case ProjectConfigAction.LearnMore:
                if (isTypeScriptProject) {
                    vscode_1.commands.executeCommand('vscode.open', vscode_1.Uri.parse('https://go.microsoft.com/fwlink/?linkid=841896'));
                }
                else {
                    vscode_1.commands.executeCommand('vscode.open', vscode_1.Uri.parse('https://go.microsoft.com/fwlink/?linkid=759670'));
                }
                return;
        }
    }
    configurationChanged() {
        const config = vscode_1.workspace.getConfiguration('typescript');
        this.reportStyleCheckAsWarnings = config.get('reportStyleChecksAsWarnings', true);
    }
    async findLanguage(file) {
        try {
            const doc = await vscode_1.workspace.openTextDocument(this.client.asUrl(file));
            return this.languages.find(language => language.handles(file, doc));
        }
        catch (_a) {
            return undefined;
        }
    }
    triggerAllDiagnostics() {
        for (const language of this.languagePerId.values()) {
            language.triggerAllDiagnostics();
        }
    }
    /* internal */ populateService() {
        // See https://github.com/Microsoft/TypeScript/issues/5530
        vscode_1.workspace.saveAll(false).then(() => {
            for (const language of this.languagePerId.values()) {
                language.reInitialize();
            }
        });
    }
    /* internal */ syntaxDiagnosticsReceived(event) {
        const body = event.body;
        if (body && body.diagnostics) {
            this.findLanguage(body.file).then(language => {
                if (language) {
                    language.syntaxDiagnosticsReceived(this.client.asUrl(body.file), this.createMarkerDatas(body.diagnostics, language.diagnosticSource));
                }
            });
        }
    }
    /* internal */ semanticDiagnosticsReceived(event) {
        const body = event.body;
        if (body && body.diagnostics) {
            this.findLanguage(body.file).then(language => {
                if (language) {
                    language.semanticDiagnosticsReceived(this.client.asUrl(body.file), this.createMarkerDatas(body.diagnostics, language.diagnosticSource));
                }
            });
        }
    }
    /* internal */ configFileDiagnosticsReceived(event) {
        // See https://github.com/Microsoft/TypeScript/issues/10384
        const body = event.body;
        if (!body || !body.diagnostics || !body.configFile) {
            return;
        }
        (this.findLanguage(body.configFile)).then(language => {
            if (!language) {
                return;
            }
            if (body.diagnostics.length === 0) {
                language.configFileDiagnosticsReceived(this.client.asUrl(body.configFile), []);
            }
            else if (body.diagnostics.length >= 1) {
                vscode_1.workspace.openTextDocument(convert_1.toUri(body.configFile)).then((document) => {
                    let curly = undefined;
                    let nonCurly = undefined;
                    let diagnostic;
                    for (let index = 0; index < document.lineCount; index++) {
                        const line = document.lineAt(index);
                        const text = line.text;
                        const firstNonWhitespaceCharacterIndex = line.firstNonWhitespaceCharacterIndex;
                        if (firstNonWhitespaceCharacterIndex < text.length) {
                            if (text.charAt(firstNonWhitespaceCharacterIndex) === '{') {
                                curly = [index, firstNonWhitespaceCharacterIndex, firstNonWhitespaceCharacterIndex + 1];
                                break;
                            }
                            else {
                                const matches = /\s*([^\s]*)(?:\s*|$)/.exec(text.substr(firstNonWhitespaceCharacterIndex));
                                if (matches && matches.length >= 1) {
                                    nonCurly = [index, firstNonWhitespaceCharacterIndex, firstNonWhitespaceCharacterIndex + matches[1].length];
                                }
                            }
                        }
                    }
                    const match = curly || nonCurly;
                    if (match) {
                        diagnostic = new vscode_1.Diagnostic(new vscode_1.Range(match[0], match[1], match[0], match[2]), body.diagnostics[0].text);
                    }
                    else {
                        diagnostic = new vscode_1.Diagnostic(new vscode_1.Range(0, 0, 0, 0), body.diagnostics[0].text);
                    }
                    if (diagnostic) {
                        diagnostic.source = language.diagnosticSource;
                        language.configFileDiagnosticsReceived(this.client.asUrl(body.configFile), [diagnostic]);
                    }
                }, _error => {
                    language.configFileDiagnosticsReceived(this.client.asUrl(body.configFile), [new vscode_1.Diagnostic(new vscode_1.Range(0, 0, 0, 0), body.diagnostics[0].text)]);
                });
            }
        });
    }
    createMarkerDatas(diagnostics, source) {
        const result = [];
        for (let diagnostic of diagnostics) {
            const { start, end, text } = diagnostic;
            const range = new vscode_1.Range(convert_1.tsLocationToVsPosition(start), convert_1.tsLocationToVsPosition(end));
            const converted = new vscode_1.Diagnostic(range, text);
            converted.severity = this.getDiagnosticSeverity(diagnostic);
            converted.source = diagnostic.source || source;
            if (diagnostic.code) {
                converted.code = diagnostic.code;
            }
            result.push(converted);
        }
        return result;
    }
    getDiagnosticSeverity(diagnostic) {
        if (this.reportStyleCheckAsWarnings && this.isStyleCheckDiagnostic(diagnostic.code)) {
            return vscode_1.DiagnosticSeverity.Warning;
        }
        switch (diagnostic.category) {
            case PConst.DiagnosticCategory.error:
                return vscode_1.DiagnosticSeverity.Error;
            case PConst.DiagnosticCategory.warning:
                return vscode_1.DiagnosticSeverity.Warning;
            default:
                return vscode_1.DiagnosticSeverity.Error;
        }
    }
    isStyleCheckDiagnostic(code) {
        return code ? styleCheckDiagnostics.indexOf(code) !== -1 : false;
    }
}
exports.TypeScriptServiceClientHost = TypeScriptServiceClientHost;

//# sourceMappingURL=typescriptMain.js.map
