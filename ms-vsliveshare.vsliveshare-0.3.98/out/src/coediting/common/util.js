"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion violation: ${message}`);
    }
}
exports.assert = assert;
function makeColorizeFunc(startEscape) {
    return (str) => {
        return startEscape + str + '\x1b[0m';
    };
}
var colorize;
(function (colorize) {
    colorize.black = makeColorizeFunc('\x1b[30m');
    colorize.red = makeColorizeFunc('\x1b[31m');
    colorize.green = makeColorizeFunc('\x1b[32m');
    colorize.yellow = makeColorizeFunc('\x1b[33m');
    colorize.blue = makeColorizeFunc('\x1b[34m');
    colorize.magenta = makeColorizeFunc('\x1b[35m');
    colorize.cyan = makeColorizeFunc('\x1b[36m');
    colorize.white = makeColorizeFunc('\x1b[37m');
})(colorize = exports.colorize || (exports.colorize = {}));
class LoggerImpl {
    constructor() {
        this.indentValue = 0;
    }
    indent() {
        this.indentValue++;
    }
    reset() {
        this.indentValue = 0;
    }
    unindent() {
        this.indentValue--;
    }
    logTrace(trace, ...str) {
        this.logInternal(trace.verbose, ...str);
    }
    log(...str) {
        this.logInternal(console.log, ...str);
    }
    logInternal(logFunc, ...str) {
        let result = '';
        for (let i = 0; i < this.indentValue; i++) {
            result += '|   ';
        }
        logFunc(result + str.join(''));
    }
}
exports.LoggerImpl = LoggerImpl;
exports.logger = new LoggerImpl();

//# sourceMappingURL=util.js.map
