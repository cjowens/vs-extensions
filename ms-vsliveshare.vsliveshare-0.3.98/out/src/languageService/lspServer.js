"use strict";
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const codeConverter = require("vscode-languageclient/lib/codeConverter");
const protocolConverter = require("vscode-languageclient/lib/protocolConverter");
const vscodeLSP = require("vscode-languageserver-protocol");
const config_1 = require("../config");
const code2protocolExtension_1 = require("./code2protocolExtension");
const commandHandler = require("./commandHandler");
const universalLanguageServerProvider_1 = require("./universalLanguageServerProvider");
const languageServiceTelemetry_1 = require("../telemetry/languageServiceTelemetry");
const telemetry_1 = require("../telemetry/telemetry");
exports.REMOTE_COMMAND_NAME = '_liveshare.remotecommand';
let universalProvider;
function activateAsync(workspaceService) {
    return __awaiter(this, void 0, void 0, function* () {
        if (config_1.featureFlags.lsp) {
            universalProvider = new universalLanguageServerProvider_1.UniversalLanguageServerProvider(workspaceService);
            yield universalProvider.initAsync();
            setupHandlers(universalProvider);
        }
    });
}
exports.activateAsync = activateAsync;
function dispose() {
    return __awaiter(this, void 0, void 0, function* () {
        if (universalProvider) {
            yield universalProvider.dispose();
        }
    });
}
exports.dispose = dispose;
function getExternalDocumentAsync(pathManager, uri, token) {
    return __awaiter(this, void 0, void 0, function* () {
        let originalUri = pathManager.getOriginalUri(uri);
        let document = yield vscode.workspace.openTextDocument(originalUri);
        return document.getText();
    });
}
function setupHandlers(languageServerProvider) {
    let connection = languageServerProvider.createProtocolConnection();
    let p2c = protocolConverter.createConverter((value) => { return languageServerProvider.PathManager.protocol2CodeUriConverter(value); });
    let c2p = codeConverter.createConverter((value) => { return languageServerProvider.PathManager.code2ProtocolUriConverter(value); });
    let c2pExt = code2protocolExtension_1.createConverterExtension(c2p);
    try {
        // Setup diagnostics
        vscode.languages.onDidChangeDiagnostics((e) => {
            for (let uri of e.uris) {
                try {
                    let diagnostics = vscode.languages.getDiagnostics(uri);
                    let params = {
                        uri: c2p.asUri(uri),
                        diagnostics: c2p.asDiagnostics(diagnostics)
                    };
                    connection.sendNotification(vscodeLSP.PublishDiagnosticsNotification.type.method, params);
                }
                catch (e) {
                    // Even if we fail to get diagnostics for one URI, we should still continue with the rest
                    telemetry_1.Instance.sendFault(languageServiceTelemetry_1.LanguageServiceTelemetryEventNames.GET_DIAGNOSTICS_FAULT, telemetry_1.FaultType.NonBlockingFault, 'Unable to get diagnostics', e);
                }
            }
        });
    }
    catch (_a) { }
    connection.onRequest(vscodeLSP.InitializeRequest.type, (params) => {
        console.log('Initialize Request received');
        let capabilities = {
            hoverProvider: true,
            definitionProvider: true,
            typeDefinitionProvider: true,
            referencesProvider: true,
            implementationProvider: true,
            completionProvider: {
                triggerCharacters: ['.']
            },
            signatureHelpProvider: {
                triggerCharacters: ['(', ',']
            },
            //documentHighlightProvider: true, // Disabled due to https://github.com/Microsoft/vscode/issues/44848
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            codeActionProvider: true,
            //codeLensProvider: {resolveProvider: false}, // Disabled due to https://github.com/Microsoft/vscode/issues/44846
            documentFormattingProvider: true,
            documentRangeFormattingProvider: true,
            documentOnTypeFormattingProvider: {
                firstTriggerCharacter: '}',
                moreTriggerCharacter: [';', '\n']
            },
            renameProvider: true,
            documentLinkProvider: {
                resolveProvider: false
            },
            colorProvider: true
        };
        let result = {
            capabilities
        };
        return result;
    });
    connection.onCustomRequest('liveshare/externalDocument', (params, token) => __awaiter(this, void 0, void 0, function* () {
        const uri = params.textDocument.uri;
        return yield getExternalDocumentAsync(languageServerProvider.PathManager, uri, token);
    }));
    connection.onCustomRequest('liveshare/load', (params) => __awaiter(this, void 0, void 0, function* () {
        return null;
    }));
    connection.onCustomRequest('liveshare/diagnosticsDocument', (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = params.textDocument.uri;
        return c2p.asDiagnostics(vscode.languages.getDiagnostics(p2c.asUri(uri)));
    }));
    connection.onRequest(vscodeLSP.HoverRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let hovers = yield vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position);
        if (!hovers || hovers.length === 0) {
            return null;
        }
        // LSP lets us return only one hover but we may have hovers from multiple providers. Merge them into one.
        let mergedContents = hovers.map((v) => v.contents).reduce((prev, curr, index, arr) => prev.concat(curr));
        let mergedHover = new vscode.Hover(mergedContents, hovers[0].range);
        return c2pExt.asHover(mergedHover);
    }));
    connection.onRequest(vscodeLSP.DefinitionRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let definition = yield vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position);
        return c2pExt.asDefinitionResult(definition);
    }));
    connection.onRequest(vscodeLSP.TypeDefinitionRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let typeDefinition;
        try {
            typeDefinition = yield vscode.commands.executeCommand('vscode.executeTypeDefinitionProvider', uri, position);
        }
        catch (e) { }
        return typeDefinition ? typeDefinition.map(d => c2pExt.asLocation(d)) : null;
    }));
    connection.onRequest(vscodeLSP.ReferencesRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let references = yield vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position);
        return c2pExt.asReferences(references);
    }));
    connection.onRequest(vscodeLSP.ImplementationRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let definition = yield vscode.commands.executeCommand('vscode.executeImplementationProvider', uri, position);
        return c2pExt.asDefinitionResult(definition);
    }));
    connection.onRequest(vscodeLSP.DocumentHighlightRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let highlights = yield vscode.commands.executeCommand('vscode.executeDocumentHighlights', uri, position);
        return c2pExt.asDocumentHighlights(highlights);
    }));
    connection.onRequest(vscodeLSP.CompletionRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let list = yield vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, position, params.context ? params.context.triggerCharacter : undefined);
        if (!list) {
            return undefined;
        }
        return list.items.map(item => c2p.asCompletionItem(item));
    }));
    connection.onRequest(vscodeLSP.SignatureHelpRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let sigHelp = yield vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', uri, position);
        return c2pExt.asSignatureHelp(sigHelp);
    }));
    connection.onRequest(vscodeLSP.DocumentSymbolRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let symbols = yield vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
        return c2pExt.asSymbolInformations(symbols);
    }));
    connection.onRequest(vscodeLSP.WorkspaceSymbolRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let symbols = yield vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', params.query);
        return c2pExt.asSymbolInformations(symbols);
    }));
    connection.onRequest(vscodeLSP.CodeActionRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let range = p2c.asRange(params.range);
        //In VSCode 1.20 and above this API can return a command or a codeaction type which contains edits.  
        let commandsOrActions = yield vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, range);
        if (!commandsOrActions) {
            return undefined;
        }
        // We wrap the command in a _liveshare.remotecommand which knows to send the command back to the server to execute or run it locally.
        return commandsOrActions.map(commandOrAction => commandHandler.wrapCommandOrCodeAction(commandOrAction, c2p, c2pExt));
    }));
    connection.onRequest(vscodeLSP.CodeLensRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let codeLenses = yield vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri);
        if (!codeLenses) {
            return undefined;
        }
        return codeLenses.map(codeLens => c2p.asCodeLens(codeLens));
    }));
    connection.onRequest(vscodeLSP.ExecuteCommandRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        const args = params.arguments || [];
        yield vscode.commands.executeCommand(params.command, ...args);
    }));
    connection.onRequest(vscodeLSP.DocumentFormattingRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let edits = yield vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', uri, params.options);
        if (!edits) {
            return undefined;
        }
        return edits.map(edit => c2p.asTextEdit(edit));
    }));
    connection.onRequest(vscodeLSP.DocumentRangeFormattingRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let range = p2c.asRange(params.range);
        let edits = yield vscode.commands.executeCommand('vscode.executeFormatRangeProvider', uri, range, params.options);
        if (!edits) {
            return undefined;
        }
        return edits.map(edit => c2p.asTextEdit(edit));
    }));
    connection.onRequest(vscodeLSP.DocumentOnTypeFormattingRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let edits = yield vscode.commands.executeCommand('vscode.executeFormatOnTypeProvider', uri, position, params.ch, params.options);
        if (!edits) {
            return undefined;
        }
        return edits.map(edit => c2p.asTextEdit(edit));
    }));
    connection.onRequest(vscodeLSP.RenameRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let position = p2c.asPosition(params.position);
        let workspaceEdit = yield vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, position, params.newName);
        return c2pExt.asWorkspaceEdit(workspaceEdit);
    }));
    connection.onRequest(vscodeLSP.DocumentLinkRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let links = yield vscode.commands.executeCommand('vscode.executeLinkProvider', uri);
        if (!links) {
            return undefined;
        }
        return links.map(link => c2p.asDocumentLink(link));
    }));
    connection.onRequest(vscodeLSP.DocumentColorRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let uri = p2c.asUri(params.textDocument.uri);
        let colors;
        try {
            colors = yield vscode.commands.executeCommand('vscode.executeDocumentColorProvider', uri);
        }
        catch (e) { }
        return colors ? colors.map(c => c2pExt.asColorInformation(c)) : colors;
    }));
    connection.onRequest(vscodeLSP.ColorPresentationRequest.type, (params) => __awaiter(this, void 0, void 0, function* () {
        let context = {
            uri: p2c.asUri(params.textDocument.uri),
            range: p2c.asRange(params.range)
        };
        let color = new vscode.Color(params.color.red, params.color.green, params.color.blue, params.color.alpha);
        let colorPresentations;
        try {
            colorPresentations = yield vscode.commands.executeCommand('vscode.executeColorPresentationProvider', color, context);
        }
        catch (e) { }
        return colorPresentations ? colorPresentations.map(cp => c2pExt.asColorPresentation(cp)) : colorPresentations;
    }));
}
exports.setupHandlers = setupHandlers;

//# sourceMappingURL=lspServer.js.map
