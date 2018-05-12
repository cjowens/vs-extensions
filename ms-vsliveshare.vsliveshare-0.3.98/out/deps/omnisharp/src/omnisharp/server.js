"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const child_process_1 = require("child_process");
const readline_1 = require("readline");
const launcher_1 = require("./launcher");
const options_1 = require("./options");
const logger_1 = require("../logger");
const delayTracker_1 = require("./delayTracker");
const launcher_2 = require("./launcher");
const requestQueue_1 = require("./requestQueue");
const remoteStream_1 = require("../remoteStream");
const os = require("os");
const path = require("path");
const utils = require("../common");
const vscode = require("vscode");
const timers_1 = require("timers");
var ServerState;
(function (ServerState) {
    ServerState[ServerState["Starting"] = 0] = "Starting";
    ServerState[ServerState["Started"] = 1] = "Started";
    ServerState[ServerState["Stopped"] = 2] = "Stopped";
})(ServerState || (ServerState = {}));
var Events;
(function (Events) {
    Events.StateChanged = 'stateChanged';
    Events.StdOut = 'stdout';
    Events.StdErr = 'stderr';
    Events.Error = 'Error';
    Events.ServerError = 'ServerError';
    Events.UnresolvedDependencies = 'UnresolvedDependencies';
    Events.PackageRestoreStarted = 'PackageRestoreStarted';
    Events.PackageRestoreFinished = 'PackageRestoreFinished';
    Events.ProjectChanged = 'ProjectChanged';
    Events.ProjectAdded = 'ProjectAdded';
    Events.ProjectRemoved = 'ProjectRemoved';
    Events.MsBuildProjectDiagnostics = 'MsBuildProjectDiagnostics';
    Events.TestMessage = 'TestMessage';
    Events.BeforeServerInstall = 'BeforeServerInstall';
    Events.BeforeServerStart = 'BeforeServerStart';
    Events.ServerStart = 'ServerStart';
    Events.ServerStop = 'ServerStop';
    Events.MultipleLaunchTargets = 'server:MultipleLaunchTargets';
    Events.Started = 'started';
})(Events || (Events = {}));
const TelemetryReportingDelay = 2 * 60 * 1000; // two minutes
class OmniSharpServer {
    constructor(reporter, remoteManager) {
        this._debugMode = false;
        this._disposables = [];
        this._telemetryIntervalId = undefined;
        this._eventBus = new events_1.EventEmitter();
        this._state = ServerState.Stopped;
        this._reporter = reporter;
        this._channel = vscode.window.createOutputChannel('OmniSharp Log');
        this._logger = new logger_1.Logger(message => this._channel.append(message));
        const logger = this._debugMode
            ? this._logger
            : new logger_1.Logger(message => { });
        this._requestQueue = new requestQueue_1.RequestQueueCollection(logger, 8, request => this._makeRequest(request));
        this._remoteManager = remoteManager;
    }
    isRunning() {
        return this._state === ServerState.Started;
    }
    waitForEmptyEventQueue() {
        return __awaiter(this, void 0, void 0, function* () {
            while (!this._requestQueue.isEmpty()) {
                let p = new Promise((resolve) => timers_1.setTimeout(resolve, 100));
                yield p;
            }
        });
    }
    _getState() {
        return this._state;
    }
    _setState(value) {
        if (typeof value !== 'undefined' && value !== this._state) {
            this._state = value;
            this._fireEvent(Events.StateChanged, this._state);
        }
    }
    _recordRequestDelay(requestName, elapsedTime) {
        let tracker = this._delayTrackers[requestName];
        if (!tracker) {
            tracker = new delayTracker_1.DelayTracker(requestName);
            this._delayTrackers[requestName] = tracker;
        }
        tracker.reportDelay(elapsedTime);
    }
    _reportTelemetry() {
        const delayTrackers = this._delayTrackers;
        for (const requestName in delayTrackers) {
            const tracker = delayTrackers[requestName];
            const eventName = 'omnisharp' + requestName;
            if (tracker.hasMeasures()) {
                const measures = tracker.getMeasures();
                tracker.clearMeasures();
                this._reporter.sendTelemetryEvent(eventName, null, measures);
            }
        }
    }
    getSolutionPathOrFolder() {
        return this._launchTarget
            ? this._launchTarget.target
            : undefined;
    }
    getChannel() {
        return this._channel;
    }
    // --- eventing
    onStdout(listener, thisArg) {
        return this._addListener(Events.StdOut, listener, thisArg);
    }
    onStderr(listener, thisArg) {
        return this._addListener(Events.StdErr, listener, thisArg);
    }
    onError(listener, thisArg) {
        return this._addListener(Events.Error, listener, thisArg);
    }
    onServerError(listener, thisArg) {
        return this._addListener(Events.ServerError, listener, thisArg);
    }
    onUnresolvedDependencies(listener, thisArg) {
        return this._addListener(Events.UnresolvedDependencies, listener, thisArg);
    }
    onBeforePackageRestore(listener, thisArg) {
        return this._addListener(Events.PackageRestoreStarted, listener, thisArg);
    }
    onPackageRestore(listener, thisArg) {
        return this._addListener(Events.PackageRestoreFinished, listener, thisArg);
    }
    onProjectChange(listener, thisArg) {
        return this._addListener(Events.ProjectChanged, listener, thisArg);
    }
    onProjectAdded(listener, thisArg) {
        return this._addListener(Events.ProjectAdded, listener, thisArg);
    }
    onProjectRemoved(listener, thisArg) {
        return this._addListener(Events.ProjectRemoved, listener, thisArg);
    }
    onMsBuildProjectDiagnostics(listener, thisArg) {
        return this._addListener(Events.MsBuildProjectDiagnostics, listener, thisArg);
    }
    onTestMessage(listener, thisArg) {
        return this._addListener(Events.TestMessage, listener, thisArg);
    }
    onBeforeServerInstall(listener) {
        return this._addListener(Events.BeforeServerInstall, listener);
    }
    onBeforeServerStart(listener) {
        return this._addListener(Events.BeforeServerStart, listener);
    }
    onServerStart(listener) {
        return this._addListener(Events.ServerStart, listener);
    }
    onServerStop(listener) {
        return this._addListener(Events.ServerStop, listener);
    }
    onMultipleLaunchTargets(listener, thisArg) {
        return this._addListener(Events.MultipleLaunchTargets, listener, thisArg);
    }
    onOmnisharpStart(listener) {
        return this._addListener(Events.Started, listener);
    }
    _addListener(event, listener, thisArg) {
        listener = thisArg ? listener.bind(thisArg) : listener;
        this._eventBus.addListener(event, listener);
        return new vscode.Disposable(() => this._eventBus.removeListener(event, listener));
    }
    _fireEvent(event, args) {
        this._eventBus.emit(event, args);
    }
    // --- start, stop, and connect
    _start(launchTarget) {
        this._setState(ServerState.Starting);
        this._launchTarget = launchTarget;
        const solutionPath = launchTarget.target;
        let connectPromise;
        // If this is a remote session just setup initial state, otherwise launch
        // OmniSharp and connect to it.
        if (this._remoteManager && this._remoteManager.isRemoteSession()) {
            this._logger.appendLine(`Using remote OmniSharp server`);
            this._logger.appendLine();
            this._delayTrackers = {};
            this._fireEvent(Events.BeforeServerStart, solutionPath);
            connectPromise = this._doConnect().then(() => {
                this._setState(ServerState.Started);
                this._fireEvent(Events.ServerStart, solutionPath);
            });
        }
        else {
            const cwd = path.dirname(solutionPath);
            this._options = options_1.Options.Read();
            let args = [
                '-s', solutionPath,
                '--hostPID', process.pid.toString(),
                '--stdio',
                'DotNet:enablePackageRestore=false',
                '--encoding', 'utf-8',
                '--loglevel', this._options.loggingLevel
            ];
            if (this._options.waitForDebugger === true) {
                args.push('--debug');
            }
            this._logger.appendLine(`Starting OmniSharp server at ${new Date().toLocaleString()}`);
            this._logger.increaseIndent();
            this._logger.appendLine(`Target: ${solutionPath}`);
            this._logger.decreaseIndent();
            this._logger.appendLine();
            this._fireEvent(Events.BeforeServerStart, solutionPath);
            connectPromise = launcher_1.launchOmniSharp(cwd, args).then(value => {
                if (value.usingMono) {
                    this._logger.appendLine(`OmniSharp server started wth Mono`);
                }
                else {
                    this._logger.appendLine(`OmniSharp server started`);
                }
                this._logger.increaseIndent();
                this._logger.appendLine(`Path: ${value.command}`);
                this._logger.appendLine(`PID: ${value.process.pid}`);
                this._logger.decreaseIndent();
                this._logger.appendLine();
                this._serverProcess = value.process;
                this._writable = this._serverProcess.stdin;
                this._delayTrackers = {};
                this._setState(ServerState.Started);
                this._fireEvent(Events.ServerStart, solutionPath);
                return this._doConnect();
            });
        }
        return connectPromise.then(() => {
            // Start telemetry reporting
            this._telemetryIntervalId = setInterval(() => this._reportTelemetry(), TelemetryReportingDelay);
        }).then(() => {
            this._requestQueue.drain();
        }).catch(err => {
            this._fireEvent(Events.ServerError, err);
            return this.stop();
        });
    }
    stop() {
        while (this._disposables.length) {
            this._disposables.pop().dispose();
        }
        let cleanupPromise;
        if (this._telemetryIntervalId !== undefined) {
            // Stop reporting telemetry
            clearInterval(this._telemetryIntervalId);
            this._telemetryIntervalId = undefined;
            this._reportTelemetry();
        }
        if (!this._serverProcess) {
            // nothing to kill
            cleanupPromise = Promise.resolve();
        }
        else if (process.platform === 'win32') {
            // when killing a process in windows its child
            // processes are *not* killed but become root
            // processes. Therefore we use TASKKILL.EXE
            cleanupPromise = new Promise((resolve, reject) => {
                const killer = child_process_1.exec(`taskkill /F /T /PID ${this._serverProcess.pid}`, (err, stdout, stderr) => {
                    if (err) {
                        return reject(err);
                    }
                });
                killer.on('exit', resolve);
                killer.on('error', reject);
            });
        }
        else {
            // Kill Unix process and children
            cleanupPromise = utils.getUnixChildProcessIds(this._serverProcess.pid)
                .then(children => {
                for (let child of children) {
                    process.kill(child, 'SIGTERM');
                }
                this._serverProcess.kill('SIGTERM');
            });
        }
        return cleanupPromise.then(() => {
            this._serverProcess = null;
            this._setState(ServerState.Stopped);
            this._fireEvent(Events.ServerStop, this);
        });
    }
    restart(launchTarget = this._launchTarget) {
        if (launchTarget) {
            return this.stop().then(() => {
                this._start(launchTarget);
            });
        }
    }
    autoStart(preferredPath) {
        if (this._remoteManager) {
            if (this._remoteManager.isRemoteSession()) {
                // Create a dummy target and start the session.
                let launchTarget = { label: null, description: null, directory: null, kind: null, target: preferredPath };
                return this.restart(launchTarget);
            }
            else {
                // Nothing to start if this is not a remote session.
                return Promise.resolve();
            }
        }
        else {
            return launcher_2.findLaunchTargets().then(launchTargets => {
                // If there aren't any potential launch targets, we create file watcher and try to
                // start the server again once a *.sln, *.csproj, project.json or CSX file is created.
                if (launchTargets.length === 0) {
                    return new Promise((resolve, reject) => {
                        // 1st watch for files
                        let watcher = vscode.workspace.createFileSystemWatcher('{**/*.sln,**/*.csproj,**/project.json,**/*.csx,**/*.cake}', 
                        /*ignoreCreateEvents*/ false, 
                        /*ignoreChangeEvents*/ true, 
                        /*ignoreDeleteEvents*/ true);
                        watcher.onDidCreate(uri => {
                            watcher.dispose();
                            resolve();
                        });
                    }).then(() => {
                        // 2nd try again
                        return this.autoStart(preferredPath);
                    });
                }
                // If there's more than one launch target, we start the server if one of the targets
                // matches the preferred path. Otherwise, we fire the "MultipleLaunchTargets" event,
                // which is handled in status.ts to display the launch target selector.
                if (launchTargets.length > 1 && preferredPath) {
                    for (let launchTarget of launchTargets) {
                        if (launchTarget.target === preferredPath) {
                            // start preferred path
                            return this.restart(launchTarget);
                        }
                    }
                    this._fireEvent(Events.MultipleLaunchTargets, launchTargets);
                    return Promise.reject(undefined);
                }
                // If there's only one target, just start
                return this.restart(launchTargets[0]);
            });
        }
    }
    // --- requests et al
    makeRequest(command, data, token) {
        if (this._getState() !== ServerState.Started) {
            return Promise.reject('server has been stopped or not started');
        }
        let startTime;
        let request;
        let promise = new Promise((resolve, reject) => {
            startTime = Date.now();
            request = {
                command,
                data,
                onSuccess: value => resolve(value),
                onError: err => reject(err)
            };
            this._requestQueue.enqueue(request);
        });
        if (token) {
            token.onCancellationRequested(() => {
                this._requestQueue.cancelRequest(request);
            });
        }
        return promise.then(response => {
            let endTime = Date.now();
            let elapsedTime = endTime - startTime;
            this._recordRequestDelay(command, elapsedTime);
            return response;
        });
    }
    _doConnect() {
        let connectionPromise;
        if (this._remoteManager && this._remoteManager.isRemoteSession()) {
            let remoteReadableStream = new remoteStream_1.RemoteReadableStream(this._remoteManager);
            let remoteWritableStream = new remoteStream_1.RemoteWritableStream(this._remoteManager);
            this._readLine = readline_1.createInterface({
                input: remoteReadableStream,
                output: remoteWritableStream,
                terminal: false
            });
            this._writable = remoteWritableStream;
            connectionPromise = Promise.resolve();
        }
        else {
            this._serverProcess.stderr.on('data', (data) => {
                this._fireEvent('stderr', String(data));
            });
            this._readLine = readline_1.createInterface({
                input: this._serverProcess.stdout,
                output: this._serverProcess.stdin,
                terminal: false
            });
            connectionPromise = new Promise((resolve, reject) => {
                let listener;
                // Convert the timeout from the seconds to milliseconds, which is required by setTimeout().
                const timeoutDuration = this._options.projectLoadTimeout * 1000;
                // timeout logic
                const handle = timers_1.setTimeout(() => {
                    if (listener) {
                        listener.dispose();
                    }
                    reject(new Error("OmniSharp server load timed out. Use the 'omnisharp.projectLoadTimeout' setting to override the default delay (one minute)."));
                }, timeoutDuration);
                // handle started-event
                listener = this.onOmnisharpStart(() => {
                    if (listener) {
                        listener.dispose();
                    }
                    clearTimeout(handle);
                    resolve();
                });
            });
        }
        const lineReceived = this._onLineReceived.bind(this);
        this._readLine.addListener('line', lineReceived);
        this._disposables.push(new vscode.Disposable(() => {
            this._readLine.removeListener('line', lineReceived);
        }));
        return connectionPromise;
    }
    _onLineReceived(line) {
        line = line.trim();
        if (line[0] !== '{') {
            this._logger.appendLine(line);
            return;
        }
        let packet;
        try {
            packet = JSON.parse(line);
        }
        catch (err) {
            // This isn't JSON
            return;
        }
        if (!packet.Type) {
            // Bogus packet
            return;
        }
        switch (packet.Type) {
            case 'response':
                this._handleResponsePacket(packet);
                break;
            case 'event':
                this._handleEventPacket(packet);
                break;
            default:
                console.warn(`Unknown packet type: ${packet.Type}`);
                break;
        }
    }
    _handleResponsePacket(packet) {
        const request = this._requestQueue.dequeue(packet.Command, packet.Request_seq);
        if (!request) {
            this._logger.appendLine(`Received response for ${packet.Command} but could not find request.`);
            return;
        }
        if (this._debugMode) {
            this._logger.appendLine(`handleResponse: ${packet.Command} (${packet.Request_seq})`);
        }
        if (packet.Success) {
            request.onSuccess(packet.Body);
        }
        else {
            request.onError(packet.Message || packet.Body);
        }
        this._requestQueue.drain();
    }
    _handleEventPacket(packet) {
        if (packet.Event === 'log') {
            const entry = packet.Body;
            this._logOutput(entry.LogLevel, entry.Name, entry.Message);
        }
        else {
            // fwd all other events
            this._fireEvent(packet.Event, packet.Body);
        }
    }
    _makeRequest(request) {
        const id = OmniSharpServer._nextId++;
        const requestPacket = {
            Type: 'request',
            Seq: id,
            Command: request.command,
            Arguments: request.data
        };
        if (this._debugMode) {
            this._logger.append(`makeRequest: ${request.command} (${id})`);
            if (request.data) {
                this._logger.append(`, data=${JSON.stringify(request.data)}`);
            }
            this._logger.appendLine();
        }
        this._writable.write(JSON.stringify(requestPacket) + '\n');
        return id;
    }
    static getLogLevelPrefix(logLevel) {
        switch (logLevel) {
            case "TRACE": return "trce";
            case "DEBUG": return "dbug";
            case "INFORMATION": return "info";
            case "WARNING": return "warn";
            case "ERROR": return "fail";
            case "CRITICAL": return "crit";
            default: throw new Error(`Unknown log level value: ${logLevel}`);
        }
    }
    _isFilterableOutput(logLevel, name, message) {
        // filter messages like: /codecheck: 200 339ms
        const timing200Pattern = /^\/[\/\w]+: 200 \d+ms/;
        return logLevel === "INFORMATION"
            && name === "OmniSharp.Middleware.LoggingMiddleware"
            && timing200Pattern.test(message);
    }
    _logOutput(logLevel, name, message) {
        if (this._debugMode || !this._isFilterableOutput(logLevel, name, message)) {
            let output = `[${OmniSharpServer.getLogLevelPrefix(logLevel)}]: ${name}${os.EOL}${message}`;
            const newLinePlusPadding = os.EOL + "        ";
            output = output.replace(os.EOL, newLinePlusPadding);
            this._logger.appendLine(output);
        }
    }
}
OmniSharpServer._nextId = 1;
exports.OmniSharpServer = OmniSharpServer;

//# sourceMappingURL=server.js.map
