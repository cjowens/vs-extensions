"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
const traceSource_1 = require("../tracing/traceSource");
const service_1 = require("./service");
class DebuggerHostService extends service_1.RpcServiceClient {
    constructor(client) {
        super(client, DebuggerHostService.debuggerHostServiceName, traceSource_1.traceSource.withName(traceSource_1.TraceSources.DebugHost));
        this.registerEvent(DebuggerHostService.debugSessionChangedEvent);
    }
    getCurrentDebugSessionsAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.invoke(DebuggerHostService.getCurrentDebugSessionsMethodName);
        });
    }
    onDebugSessionChanged(handler) {
        this.on(DebuggerHostService.debugSessionChangedEvent, handler);
    }
}
DebuggerHostService.debuggerHostServiceName = 'DebuggerHostService';
DebuggerHostService.debugSessionChangedEvent = 'debugSessionChanged';
DebuggerHostService.getCurrentDebugSessionsMethodName = 'getCurrentDebugSessions';
exports.DebuggerHostService = DebuggerHostService;

//# sourceMappingURL=debuggerService.js.map
