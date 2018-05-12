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
const vscode_jsonrpc_1 = require("vscode-jsonrpc");
const vscodeLSP = require("vscode-languageclient");
const p2c = require("vscode-languageclient/lib/protocolConverter");
const config = require("../config");
const util_1 = require("../util");
const languageServiceTelemetry_1 = require("../telemetry/languageServiceTelemetry");
const telemetry_1 = require("../telemetry/telemetry");
const service_1 = require("../workspace/service");
const commandHandler = require("./commandHandler");
const externalDocumentProvider_1 = require("./externalDocumentProvider");
const languageFilterMiddleWare_1 = require("./languageFilterMiddleWare");
const lspClientStreamProvider_1 = require("./lspClientStreamProvider");
const lspServer_1 = require("./lspServer");
const pathManager_1 = require("./pathManager");
const anyLspName = 'any';
/**
 * This is a LSP client to provide services for all languages.
 */
function activateAsync(context, workspaceService) {
    return __awaiter(this, void 0, void 0, function* () {
        const lspServices = [...workspaceService.registeredServices]
            .filter(s => s.startsWith(service_1.LanguageServerProviderClient.prefixServiceName))
            .map(s => s.substring(service_1.LanguageServerProviderClient.prefixServiceName.length));
        for (const lspName of lspServices) {
            yield activateLspClient(context, workspaceService.client, lspName);
        }
        // register a document provider for the external scheme
        let externalDocumentProvider = new externalDocumentProvider_1.ExternalDocumentProvider(workspaceService.client);
        let docProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(pathManager_1.PathManager.vslsExternalScheme, externalDocumentProvider);
        context.subscriptions.push(docProviderDisposable);
    });
}
exports.activateAsync = activateAsync;
function activateLspClient(context, rpcClient, lspName) {
    return __awaiter(this, void 0, void 0, function* () {
        let languageServerProviderClient = new service_1.LanguageServerProviderClient(rpcClient, service_1.LanguageServerProviderClient.prefixServiceName + lspName);
        let lspClientStreamProvider = new lspClientStreamProvider_1.LSPClientStreamProvider(languageServerProviderClient);
        const metadata = yield languageServerProviderClient.getMetadataAsync();
        const vslsScheme = config.get(config.Key.scheme);
        let documentFilters = [];
        if (metadata.documentFilters) {
            documentFilters = metadata.documentFilters.map(d => ({ scheme: vslsScheme, language: d.language ? d.language : undefined, pattern: d.pattern ? d.pattern : undefined }));
        }
        else {
            documentFilters.push({ scheme: vslsScheme });
        }
        // define a vls schema to identify external files outside the workspace folder 
        documentFilters.push({ scheme: pathManager_1.PathManager.vslsExternalScheme });
        let clientOptions = {
            documentSelector: documentFilters,
            revealOutputChannelOn: vscodeLSP.RevealOutputChannelOn.Never,
            initializationFailedHandler: (error) => {
                lspClient.error('Server initialization failed.', error);
                telemetry_1.Instance.sendFault(languageServiceTelemetry_1.LanguageServiceTelemetryEventNames.LSPSERVER_INIT_FAULT, telemetry_1.FaultType.Unknown, `Server ${lspName} initialization failed - ${error}`);
                return false;
            },
            middleware: config.featureFlags.lspForCSTS ? {} : new languageFilterMiddleWare_1.LanguageFilterMiddleWare(),
        };
        let lspClient = new vscodeLSP.LanguageClient('LiveShareGuest-' + lspName, 'Guest-' + lspName, () => {
            return Promise.resolve({
                reader: new vscode_jsonrpc_1.StreamMessageReader(lspClientStreamProvider.ReadStream),
                writer: new vscode_jsonrpc_1.StreamMessageWriter(lspClientStreamProvider.WriteStream)
            });
        }, clientOptions);
        let remoteCmndName = lspServer_1.REMOTE_COMMAND_NAME;
        let p2cConverter = p2c.createConverter();
        if (lspName === anyLspName) {
            context.subscriptions.push(lspClient.start());
            vscode.workspace.onDidOpenTextDocument((textDocument) => __awaiter(this, void 0, void 0, function* () {
                yield populateDiagnostics(lspClient, textDocument, p2cConverter);
            }), undefined, context.subscriptions);
        }
        else {
            remoteCmndName = remoteCmndName.concat('.', lspName);
            let started = false;
            vscode.workspace.onDidOpenTextDocument((textDocument) => __awaiter(this, void 0, void 0, function* () {
                if (textDocument.languageId === lspName || documentFilters.some(d => d.language === textDocument.languageId)) {
                    if (!started) {
                        started = true;
                        context.subscriptions.push(lspClient.start());
                    }
                    yield populateDiagnostics(lspClient, textDocument, p2cConverter);
                }
                return true;
            }), undefined, context.subscriptions);
        }
        let remoteCommand = util_1.ExtensionUtil.registerCommand(remoteCmndName, (args) => __awaiter(this, void 0, void 0, function* () {
            yield commandHandler.handleLiveShareRemoteCommand(args, lspClient, p2cConverter);
        }));
        context.subscriptions.push(remoteCommand);
    });
}
function populateDiagnostics(lspClient, textDocument, p2cConverter) {
    return __awaiter(this, void 0, void 0, function* () {
        // Whenever an output view is open, VS Code fires an open text document event. Ignore requests for diagnostics on these "documents"
        if (textDocument.uri.scheme === 'output') {
            return;
        }
        yield lspClient.onReady();
        let diagnostics = yield lspClient.sendRequest('liveshare/diagnosticsDocument', { textDocument: { uri: textDocument.uri.toString() } });
        if (diagnostics && lspClient.diagnostics) {
            lspClient.diagnostics.set(textDocument.uri, p2cConverter.asDiagnostics(diagnostics));
        }
    });
}

//# sourceMappingURL=lspClient.js.map
