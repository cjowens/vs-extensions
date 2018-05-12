/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const os = require("os");
const path = require("path");
exports.PowerShellLanguageId = "powershell";
function ensurePathExists(targetPath) {
    // Ensure that the path exists
    try {
        fs.mkdirSync(targetPath);
    }
    catch (e) {
        // If the exception isn't to indicate that the folder exists already, rethrow it.
        if (e.code !== "EEXIST") {
            throw e;
        }
    }
}
exports.ensurePathExists = ensurePathExists;
function getPipePath(pipeName) {
    if (os.platform() === "win32") {
        return "\\\\.\\pipe\\" + pipeName;
    }
    else {
        // On UNIX platforms the pipe will live under the temp path
        // For details on how this path is computed, see the corefx
        // source for System.IO.Pipes.PipeStream:
        // tslint:disable-next-line:max-line-length
        // https://github.com/dotnet/corefx/blob/d0dc5fc099946adc1035b34a8b1f6042eddb0c75/src/System.IO.Pipes/src/System/IO/Pipes/PipeStream.Unix.cs#L340
        return path.resolve(os.tmpdir(), ".dotnet", "corefx", "pipe", pipeName);
    }
}
exports.getPipePath = getPipePath;
const sessionsFolder = path.resolve(__dirname, "..", "..", "sessions/");
const sessionFilePathPrefix = path.resolve(sessionsFolder, "PSES-VSCode-" + process.env.VSCODE_PID);
// Create the sessions path if it doesn't exist already
ensurePathExists(sessionsFolder);
function getSessionFilePath(uniqueId) {
    return `${sessionFilePathPrefix}-${uniqueId}`;
}
exports.getSessionFilePath = getSessionFilePath;
function getDebugSessionFilePath() {
    return `${sessionFilePathPrefix}-Debug`;
}
exports.getDebugSessionFilePath = getDebugSessionFilePath;
function writeSessionFile(sessionFilePath, sessionDetails) {
    ensurePathExists(sessionsFolder);
    const writeStream = fs.createWriteStream(sessionFilePath);
    writeStream.write(JSON.stringify(sessionDetails));
    writeStream.close();
}
exports.writeSessionFile = writeSessionFile;
function waitForSessionFile(sessionFilePath, callback) {
    function innerTryFunc(remainingTries, delayMilliseconds) {
        if (remainingTries === 0) {
            callback(undefined, "Timed out waiting for session file to appear.");
        }
        else if (!checkIfFileExists(sessionFilePath)) {
            // Wait a bit and try again
            setTimeout(() => { innerTryFunc(remainingTries - 1, delayMilliseconds); }, delayMilliseconds);
        }
        else {
            // Session file was found, load and return it
            callback(readSessionFile(sessionFilePath), undefined);
        }
    }
    // Try once per second for 60 seconds, one full minute
    innerTryFunc(60, 1000);
}
exports.waitForSessionFile = waitForSessionFile;
function readSessionFile(sessionFilePath) {
    const fileContents = fs.readFileSync(sessionFilePath, "utf-8");
    return JSON.parse(fileContents);
}
exports.readSessionFile = readSessionFile;
function deleteSessionFile(sessionFilePath) {
    try {
        fs.unlinkSync(sessionFilePath);
    }
    catch (e) {
        // TODO: Be more specific about what we're catching
    }
}
exports.deleteSessionFile = deleteSessionFile;
function checkIfFileExists(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
    }
    catch (e) {
        return false;
    }
}
exports.checkIfFileExists = checkIfFileExists;
function getTimestampString() {
    const time = new Date();
    return `[${time.getHours()}:${time.getMinutes()}:${time.getSeconds()}]`;
}
exports.getTimestampString = getTimestampString;
function isWindowsOS() {
    return os.platform() === "win32";
}
exports.isWindowsOS = isWindowsOS;
//# sourceMappingURL=utils.js.map