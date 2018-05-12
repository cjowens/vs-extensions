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
const stream = require("stream");
const traceSource_1 = require("../tracing/traceSource");
const TracingConstants_1 = require("../tracing/TracingConstants");
const vscode_jsonrpc_1 = require("vscode-jsonrpc");
const session = require("../session");
/**
 * This class provides readable and writable streams that can be connected to a LSP client and on the side performs requests via LiveShare
 */
class LSPClientStreamProvider {
    constructor(languageServerProviderClient) {
        this.languageServerProviderClient = languageServerProviderClient;
        this.nextId = 0;
        this.trace = traceSource_1.traceSource.withName(TracingConstants_1.TraceSources.ClientLSP);
        // Set up read and write streams that we hand out the LSP client. Connect them to a reader and writer using which we can pipe messages in.
        this.readStream = new stream.Readable({ read: () => { } });
        this.readStreamWriter = new stream.Writable({ write: (chunk, encoding, callback) => {
                this.readStream.push(chunk, encoding);
                callback();
            } });
        this.writeStreamReader = new stream.Readable({ read: () => { } });
        this.writeStream = new stream.Writable({ write: (chunk, encoding, callback) => {
                this.writeStreamReader.push(chunk, encoding);
                callback();
            } });
        let logger = {
            info: this.trace.info,
            warn: this.trace.warning,
            error: this.trace.error,
            log: this.trace.verbose
        };
        // Setup a rpc connection to the stream readers so that we can decode the messages to a RPC message object that we can send
        // to the host side.
        let connection = vscode_jsonrpc_1.createMessageConnection(new vscode_jsonrpc_1.StreamMessageReader(this.writeStreamReader), new vscode_jsonrpc_1.StreamMessageWriter(this.readStreamWriter), logger);
        connection.onRequest((method, params, token) => __awaiter(this, void 0, void 0, function* () {
            let rpcRequest = { id: this.nextId, method: method, params: params, jsonrpc: '2.0' };
            let coeditingInformation = { highestLocalTextChange: session.SessionContext.coeditingClient.currentHighestLocalTextChange,
                serverVersion: session.SessionContext.coeditingClient.currentServerVersion,
                clientId: session.SessionContext.coeditingClient.clientID };
            let response = yield languageServerProviderClient.requestAsync(rpcRequest, coeditingInformation);
            return response;
        }));
        connection.onNotification((method, params, token) => __awaiter(this, void 0, void 0, function* () {
            let notification = { jsonrpc: '2.0', method: method, params: params };
            yield languageServerProviderClient.notifyAsync(notification);
        }));
        languageServerProviderClient.onNotified((notificationEventArgs) => {
            const notificationMessage = notificationEventArgs.body;
            connection.sendNotification(notificationMessage.method, notificationMessage.params);
        });
        connection.listen();
    }
    get ReadStream() {
        return this.readStream;
    }
    get WriteStream() {
        return this.writeStream;
    }
}
exports.LSPClientStreamProvider = LSPClientStreamProvider;

//# sourceMappingURL=lspClientStreamProvider.js.map
