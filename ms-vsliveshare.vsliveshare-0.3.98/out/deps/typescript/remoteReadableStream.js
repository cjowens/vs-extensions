"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const stream = require("stream");
const os = require("os");
class RemoteReadableStream extends stream.Readable {
    constructor(remoteManager) {
        super();
        this.remoteManager = remoteManager;
    }
    _read(_size) {
        if (!this.remoteManager.isRemoteSession()) {
            return;
        }
        // TSServer responses are in the following format:
        // Content-Length: 76
        // <empty line>
        // {"seq":0,"type":"response","command":"open","request_seq":1,"success":true}
        this.remoteManager.readLinesAsync("typescript_ls" /* TypeScriptLanguageService */, 3).then((value) => {
            const lines = value.split(os.EOL);
            if (lines.length < 3) {
                // Expected responses to adhere to the above format
                return;
            }
            const contentLength = this.tryGetContentLength(lines[0]);
            if (!contentLength) {
                // Expected content-length
                return;
            }
            if (this.removeWhitespace(lines[1]).length) {
                // Expected empty line
                return;
            }
            this.push(lines[2]);
        });
    }
    tryGetContentLength(contentLengthText) {
        const contentLengthPrefix = 'Content-Length: ';
        return parseInt(contentLengthText.substring(contentLengthPrefix.length), 10);
    }
    removeWhitespace(text) {
        return text.replace(/\s/g, '');
    }
}
exports.RemoteReadableStream = RemoteReadableStream;

//# sourceMappingURL=remoteReadableStream.js.map
