"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stream = require("stream");
class RemoteReadableStream extends stream.Readable {
    constructor(remoteManager) {
        super();
        this.remoteManager = remoteManager;
    }
    _read(size) {
        this.remoteManager.readLineAsync("csharp_ls" /* CSharpLanguageService */).then((line) => {
            // Add a '\n' since readline will have removed it and the '\n' is responsible for raising the 'line' event which ReadLine needs.
            this.push(line + '\n');
        });
    }
}
exports.RemoteReadableStream = RemoteReadableStream;
class RemoteWritableStream extends stream.Writable {
    constructor(remoteManager) {
        super();
        this.remoteManager = remoteManager;
    }
    _write(chunk, encoding, callback) {
        // Chop off \n at the end since writeLineAsync will add one.
        let line = chunk.toString().trim();
        this.remoteManager.writeLineAsync("csharp_ls" /* CSharpLanguageService */, line).then(value => {
            callback();
        });
    }
}
exports.RemoteWritableStream = RemoteWritableStream;

//# sourceMappingURL=remoteStream.js.map
