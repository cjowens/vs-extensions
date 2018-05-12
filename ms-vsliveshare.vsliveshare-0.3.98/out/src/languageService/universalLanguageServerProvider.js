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
const vscodeLSP = require("vscode-languageserver-protocol");
const session = require("../session");
const languageServiceTelemetry_1 = require("../telemetry/languageServiceTelemetry");
const TracingConstants_1 = require("../tracing/TracingConstants");
const traceSource_1 = require("../tracing/traceSource");
const WorkspaceServiceTypes_1 = require("../workspace/contract/WorkspaceServiceTypes");
const pathManager = require("./pathManager");
/**
 * A language service provider that provides language services in a language-agnostic way
 * by talking to the VSCode APIs.
 */
class UniversalLanguageServerProvider {
    constructor(workspaceService) {
        this.workspaceService = workspaceService;
        this.requestHandlers = new Map();
        this.notificationHandlers = new Map();
        this.pathManager = new pathManager.PathManager();
        // For telemetry purposes
        this.servicedRequests = 0;
        this.rejectedRequests = 0;
        this.unacknowledgedHostChangesRejects = 0;
        // A list of LSP requests that don't require that the guest's buffer matches the host's to service.
        // E.g. there's no need to validate the 'initialize' request.
        this.requestsThatDontNeedValidation = [
            vscodeLSP.InitializeRequest.type.method, vscodeLSP.ShutdownRequest.type.method,
            'liveshare/externalDocument', 'liveshare/load', 'liveshare/diagnosticsDocument'
        ];
        this.rpcClient = workspaceService.client;
        this.trace = traceSource_1.traceSource.withName(TracingConstants_1.TraceSources.ClientLSP);
    }
    get PathManager() {
        return this.pathManager;
    }
    initAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.workspaceService.registerServicesAsync([UniversalLanguageServerProvider.SERVICE_NAME], WorkspaceServiceTypes_1.WorkspaceServicesChangeType.Add);
            this.rpcClient.addRequestMethod(UniversalLanguageServerProvider.SERVICE_NAME + '.getMetadata', (token) => {
                return { contentTypes: ['any'] };
            });
            this.rpcClient.addRequestMethod(UniversalLanguageServerProvider.SERVICE_NAME + '.request', (requestMessage, coeditingInfo, token) => __awaiter(this, void 0, void 0, function* () {
                return yield this.requestAsync(requestMessage, coeditingInfo, token);
            }));
            this.notifyCookie = this.rpcClient.addNotificationHandler(UniversalLanguageServerProvider.SERVICE_NAME + '.notify', (params, token) => __awaiter(this, void 0, void 0, function* () {
                yield this.notifyAsync(params, token);
            }));
            this.rpcClient.addRequestMethod(UniversalLanguageServerProvider.SERVICE_NAME + '.load', (token) => {
                return Promise.resolve();
            });
        });
    }
    dispose() {
        return __awaiter(this, void 0, void 0, function* () {
            languageServiceTelemetry_1.summarizeLsRequests(this.servicedRequests, this.rejectedRequests, this.unacknowledgedHostChangesRejects);
            yield this.workspaceService.registerServicesAsync([UniversalLanguageServerProvider.SERVICE_NAME], WorkspaceServiceTypes_1.WorkspaceServicesChangeType.Remove);
            this.rpcClient.removeRequestMethod(UniversalLanguageServerProvider.SERVICE_NAME + '.request');
            this.rpcClient.removeNotificationHandler(UniversalLanguageServerProvider.SERVICE_NAME + '.notify', this.notifyCookie);
            this.rpcClient.removeRequestMethod(UniversalLanguageServerProvider.SERVICE_NAME + '.load');
            this.pathManager.dispose();
        });
    }
    createProtocolConnection() {
        return {
            onRequest: (type, handler) => {
                this.requestHandlers.set(type.method, handler);
            },
            onCustomRequest: (method, handler) => {
                this.requestHandlers.set(method, handler);
            },
            onNotification: (type, handler) => {
                this.notificationHandlers.set(type.method, handler);
            },
            sendNotification: (method, params) => {
                let message = { jsonrpc: '2.0', method: method, params: params };
                this.rpcClient.sendNotification(this.trace, UniversalLanguageServerProvider.SERVICE_NAME + '.notified', { body: message });
            }
        };
    }
    requestAsync(requestMessage, coeditingInfo, token) {
        return __awaiter(this, void 0, void 0, function* () {
            if (coeditingInfo && this.requestsThatDontNeedValidation.indexOf(requestMessage.method) < 0) {
                if (!this.canServiceRequest(coeditingInfo)) {
                    this.rejectedRequests++;
                    return null;
                }
                this.servicedRequests++;
            }
            if (this.requestHandlers.has(requestMessage.method)) {
                return yield this.requestHandlers.get(requestMessage.method)(requestMessage.params, token);
            }
            return null;
        });
    }
    canServiceRequest(guestCoeditingInformation) {
        // The host's buffer has unacknowledged changes
        if (session.SessionContext.coeditingClient.hasUnacknowledgedTextChanges) {
            this.unacknowledgedHostChangesRejects++;
            return false;
        }
        let textChangeHistory = session.SessionContext.coeditingClient.textChangeHistory;
        let historyIdx = textChangeHistory.length - 1;
        // No text changes so far
        if (historyIdx < 0) {
            return true;
        }
        // Requesting guest hasn't received any text edits
        // TODO: It's not 100% valid to return true here. It could be the case that another guest has
        // made edits that make it to the host before this request does
        if (guestCoeditingInformation.serverVersion === -1) {
            return true;
        }
        else {
            for (; historyIdx >= 0; historyIdx--) {
                if (textChangeHistory[historyIdx].changeServerVersion === guestCoeditingInformation.serverVersion) {
                    break;
                }
            }
            // Did not find the textChangeEventId from the guest on the host. Must have been too long ago
            if (historyIdx < 0) {
                return false;
            }
        }
        // We're interested in checking all changes that happen *after* the last one that the guest received
        historyIdx++;
        // Check if all changes to the host's buffers between these two were due to the guest issuing the request
        for (; historyIdx < textChangeHistory.length; historyIdx++) {
            if (textChangeHistory[historyIdx].clientId !== guestCoeditingInformation.clientId) {
                // Another guest has sent a change that the guest that made the request
                // hadn't received at the time the request was made
                return false;
            }
        }
        // All text changes have been due to the client that sent the request
        return true;
    }
    notifyAsync(notificationMessage, token) {
        return __awaiter(this, void 0, void 0, function* () {
            // No need to do a check with CoEditing here if we can service the notification or not.
            // Possible Client -> Server LSP notifications are: Initialized, Exit, DidChangeWorkspaceFolders, DidChangeConfiguration,
            // DidChangeWatchedFiles, DidOpenTextDocument, DidChangeTextDocument, WillSaveTextDocument, WillSaveWaitUntilTextDocument,
            // DidCloseTextDocument. These notifications should be sent from the host and not the guest.
            if (this.notificationHandlers.has(notificationMessage.method)) {
                yield this.notificationHandlers.get(notificationMessage.method)(notificationMessage.params);
            }
        });
    }
}
UniversalLanguageServerProvider.SERVICE_NAME = 'languageServerProvider-any';
exports.UniversalLanguageServerProvider = UniversalLanguageServerProvider;

//# sourceMappingURL=universalLanguageServerProvider.js.map
