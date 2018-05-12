//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const traceSource_1 = require("./traceSource");
class OutputTraceListener extends traceSource_1.TraceListener {
    constructor(outputChannelName) {
        super();
        this.channel = vscode.window.createOutputChannel(outputChannelName);
    }
    writeLine(line) {
        this.channel.appendLine(line);
    }
    writeEvent(source, eventType, id, message) {
        const line = traceSource_1.TraceFormat.formatEvent(null, source, eventType, id, message);
        this.writeLine(line);
    }
}
exports.OutputTraceListener = OutputTraceListener;

//# sourceMappingURL=outputTraceListener.js.map
