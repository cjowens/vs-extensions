/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const os = require("os");
const net = require("net");
const cp = require("child_process");
const vscode = require("vscode");
function makeRandomHexString(length) {
    let chars = ['0', '1', '2', '3', '4', '5', '6', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
    let result = '';
    for (let i = 0; i < length; i++) {
        let idx = Math.floor(chars.length * Math.random());
        result += chars[idx];
    }
    return result;
}
function generatePipeName() {
    let randomName = 'vscode-' + makeRandomHexString(20);
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + randomName + '-sock';
    }
    // Mac/Unix: use socket file
    return path.join(os.tmpdir(), 'CoreFxPipe_' + randomName + '.sock');
}
function generatePatchedEnv(env, stdInPipeName, stdOutPipeName, stdErrPipeName) {
    // Set the two unique pipe names and the electron flag as process env
    let newEnv = {};
    /* tslint:disable:forin */
    for (let key in env) {
        newEnv[key] = env[key];
    }
    /* tslint:enable:forin */
    /* tslint:disable:no-string-literal */
    newEnv['STDIN_PIPE_NAME'] = stdInPipeName;
    newEnv['STDOUT_PIPE_NAME'] = stdOutPipeName;
    newEnv['STDERR_PIPE_NAME'] = stdErrPipeName;
    newEnv['ELECTRON_RUN_AS_NODE'] = '1';
    newEnv['ELECTRON_NO_ASAR'] = '1';
    /* tslint:enable:no-string-literal */
    return newEnv;
}
function escapeRegExp(str) {
    return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
}
function fork(modulePath, args, options, callback) {
    // Generate three unique pipe names + 1 host adapter
    let stdInPipeName = generatePipeName();
    let stdOutPipeName = generatePipeName();
    let stdErrPipeName = generatePipeName();
    let stdOutHostPipeName = generatePipeName();
    let callbackCalled = false;
    let resolve = (result) => {
        if (callbackCalled) {
            return;
        }
        callbackCalled = true;
        callback(null, result, {
            pid: result.pid,
            stdInPipeName: stdInPipeName,
            stdOutPipeName: stdOutHostPipeName,
        });
    };
    let reject = (err) => {
        if (callbackCalled) {
            return;
        }
        callbackCalled = true;
        callback(err, null, null);
    };
    let newEnv = generatePatchedEnv(options.env || process.env, stdInPipeName, stdOutPipeName, stdErrPipeName);
    let childProcess;
    // Begin listening to stderr pipe
    let stdErrServer = net.createServer((stdErrStream) => {
        // From now on the childProcess.stderr is available for reading
        childProcess.stderr = stdErrStream;
    });
    stdErrServer.listen(stdErrPipeName);
    // Begin listening to stdout pipe
    let stdOutServer = net.createServer((stdOutStream) => {
        // The child process will write exactly one chunk with content `ready` when it has installed a listener to the stdin pipe
        stdOutStream.once('data', (chunk) => {
            // The child process is sending me the `ready` chunk, time to connect to the stdin pipe
            //childProcess.stdin = <any>net.connect(stdInPipeName);
            // From now on the childProcess.stdout is available for reading
            childProcess.stdout = stdOutStream;
            // since we want another process to start using the stdout we would need to create 
            // a pipe to route the response
            let hostAdapterPipeServer = net.createServer((hostAdapterStream) => {
                stdOutStream.on('data', (chunkStdOut) => {
                    hostAdapterStream.write(chunkStdOut);
                });
            });
            hostAdapterPipeServer.listen(stdOutHostPipeName);
            resolve(childProcess);
        });
    });
    stdOutServer.listen(stdOutPipeName);
    let serverClosed = false;
    let closeServer = () => {
        if (serverClosed) {
            return;
        }
        serverClosed = true;
        process.removeListener('exit', closeServer);
        stdOutServer.close();
        stdErrServer.close();
    };
    // Create the process
    let appRoot = vscode.env.appRoot;
    appRoot = appRoot.replace(new RegExp(escapeRegExp('\\'), 'g'), '/');
    let bootstrapperPath = appRoot + '/out/vs/base/node/stdForkStart.js';
    let forkOptions = {
        silent: true,
        cwd: options.cwd,
        env: newEnv,
        execArgv: options.execArgv
    };
    childProcess = cp.fork(bootstrapperPath, [modulePath].concat(args), forkOptions);
    childProcess.once('error', (err) => {
        closeServer();
        reject(err);
    });
    childProcess.once('exit', (err) => {
        closeServer();
        reject(err);
    });
    // On vscode exit still close server #7758
    process.once('exit', closeServer);
}
exports.fork = fork;

//# sourceMappingURL=stdFork.js.map
