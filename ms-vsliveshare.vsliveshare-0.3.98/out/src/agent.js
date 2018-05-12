//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const readline_1 = require("readline");
const fs = require("fs-extra");
const url = require("url");
const child_process = require("child_process");
const path = require("path");
const os = require("os");
const uuid = require("uuid");
const traceSource_1 = require("./tracing/traceSource");
const util_1 = require("./util");
const config = require("./config");
const telemetry_1 = require("./telemetry/telemetry");
/**
 * Manages the lifecycle of the Cascade agent.
 */
class Agent {
    /**
     * Runs the agent. This promise resolves when the process outputs a "Listening" message.
     *
     * @param pipe The name of a pipe the agent should listen on.
     * @param service Optional URI of the web service the agent should use.
     */
    static start(pipe, service) {
        return __awaiter(this, void 0, void 0, function* () {
            if (Agent.IsRunning) {
                return Promise.reject('Agent process already running.');
            }
            let startEvent = telemetry_1.Instance.startTimedEvent(telemetry_1.TelemetryEventNames.START_AGENT);
            telemetry_1.TimedEvent.propagateOffsetMarkTime(telemetry_1.TelemetryPropertyNames.AGENT_SPAWN_START_TIME, startEvent);
            Agent.trace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientAgent);
            let args = ['--autoexit', '--pipe', pipe];
            if (service) {
                args = args.concat('--service', url.format(service));
            }
            return new Promise((rawResolve, rawReject) => {
                const reject = (e, site = 'not specified') => {
                    startEvent.end(telemetry_1.TelemetryResult.Failure, `Agent start failed [${site}]. ${e.message}`);
                    telemetry_1.TimedEvent.propagateOffsetMarkTime(telemetry_1.TelemetryPropertyNames.AGENT_SPAWN_END_TIME, startEvent);
                    rawReject(e);
                };
                const resolve = () => {
                    startEvent.end(telemetry_1.TelemetryResult.Success, 'Agent start success.');
                    telemetry_1.TimedEvent.propagateOffsetMarkTime(telemetry_1.TelemetryPropertyNames.AGENT_SPAWN_END_TIME, startEvent);
                    rawResolve();
                };
                let agentPath = Agent.getAgentPath();
                let options = undefined;
                if (config.featureFlags.anyCodePortable) {
                    options = { env: process.env };
                    options.env.ANYCODEPORTABLEENABLED = 'true';
                }
                Agent.cp = child_process.spawn(agentPath, args, options);
                startEvent.markTime(telemetry_1.TelemetryPropertyNames.AGENT_START_PROCESS_SPAWN_COMMAND_SENT);
                let resolved = false;
                setTimeout(() => {
                    try {
                        if (!resolved) {
                            resolved = true;
                            Agent.cp.kill();
                            const message = 'Timed out waiting for agent process to start.';
                            Agent.trace.info(message);
                            reject(new Error(message), 'init timeout');
                        }
                    }
                    catch (e) {
                        reject(e, 'init timeout error');
                    }
                }, 15000);
                let agentOutput = readline_1.createInterface({
                    input: Agent.cp.stdout
                });
                agentOutput.on('line', (line) => {
                    try {
                        // Resolve when the agent outputs a message that indicates it is listening.
                        // Afterward the client can connect to the agent without having to wait and retry.
                        Agent.trace.writeLine(line);
                        if (traceSource_1.TraceFormat.parseEventId(line) === traceSource_1.TraceEventIds.AgentLogCreated) {
                            let linePieces = line.split('Trace log: ');
                            if (linePieces.length > 1) {
                                util_1.ExtensionUtil.agentLogFilePath = linePieces[1];
                            }
                        }
                        if (!startEvent.propertyExists(telemetry_1.TelemetryPropertyNames.AGENT_START_INITAL_DATA)) {
                            startEvent.addProperty(telemetry_1.TelemetryPropertyNames.AGENT_START_INITAL_DATA, line);
                            startEvent.addProperty(telemetry_1.TelemetryPropertyNames.AGENT_START_RESOLVED_STATE, resolved.toString());
                        }
                        if (!resolved && traceSource_1.TraceFormat.parseEventId(line) === traceSource_1.TraceEventIds.RpcListeningOnPipe) {
                            resolved = true;
                            // The agent doesn't really start listening until immediately after
                            // this event. Wait a short time to reduce the chance of needing to retry.
                            setTimeout(resolve, 10);
                        }
                    }
                    catch (e) {
                        reject(e, 'on line');
                    }
                });
                Agent.cp.stderr.on('data', (data) => __awaiter(this, void 0, void 0, function* () {
                    if (!resolved && os.platform() === util_1.OSPlatform.LINUX) {
                        yield util_1.ExtensionUtil.promptLinuxDependencyInstall('VS Live Share activation failed.');
                    }
                    try {
                        Agent.trace.writeLine((data || '').toString().trim());
                    }
                    catch (e) {
                        reject(e, 'on data');
                    }
                }));
                Agent.cp.on('error', (err) => __awaiter(this, void 0, void 0, function* () {
                    try {
                        Agent.trace.error('Agent failed with error: ' + err);
                        if (!resolved) {
                            if (err.message.indexOf('spawn') > -1) {
                                const found = fs.existsSync(agentPath);
                                startEvent.addProperty(telemetry_1.TelemetryPropertyNames.AGENT_START_AGENT_FOUND, found);
                            }
                            resolved = true;
                            reject(err, 'on error before init');
                        }
                    }
                    catch (e) {
                        reject(e, 'on error');
                    }
                }));
                Agent.cp.on('close', (exitCode, signal) => {
                    try {
                        const message = 'Agent terminated with exit code: ' + exitCode + ' and signal ' + signal;
                        Agent.trace.info(message);
                        if (!resolved) {
                            resolved = true;
                            reject(new Error(message), 'on close before init');
                        }
                    }
                    catch (e) {
                        reject(e, 'on close');
                    }
                });
            });
        });
    }
    static startIfNotRunning() {
        return __awaiter(this, void 0, void 0, function* () {
            if (Agent.IsRunning) {
                return Agent.uri;
            }
            else {
                let agentUri = config.getUri(config.Key.agentUri);
                if (!agentUri) {
                    const uniquePipeName = uuid().replace(/-/g, '');
                    agentUri = url.parse('net.pipe://localhost/' + uniquePipeName);
                    const serviceUri = config.getUri(config.Key.serviceUri);
                    yield Agent.start(uniquePipeName, serviceUri);
                    Agent.uri = agentUri;
                }
                return agentUri;
            }
        });
    }
    static get IsRunning() {
        return (Agent.cp && !Agent.cp.killed);
    }
    static stop() {
        if (Agent.IsRunning) {
            Agent.cp.kill();
            Agent.cp = undefined;
        }
    }
    static disposeAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            // The agent process exits automatically when the rpc connection is disposed.
            // Wait for that to happen as that'll also perform some cleanup.
            // If that still hasn't happened then kill the process.
            if (Agent.IsRunning) {
                Agent.trace.info('Agent process is running and about to be shutdown.');
                if (!(yield Agent.WaitForAgentToExit())) {
                    Agent.trace.info('Agent process didn\'t exit within the timeout, killing it.');
                    Agent.stop();
                }
            }
        });
    }
    static getAgentPath() {
        return os.platform() === util_1.OSPlatform.WINDOWS ?
            path.join(Agent.agentBinariesPath, `${config.get(config.Key.agent)}.exe`) :
            path.join(Agent.agentBinariesPath, `${config.get(config.Key.agent)}`);
    }
    static WaitForAgentToExit() {
        if (Agent.IsRunning) {
            return new Promise((resolve, reject) => {
                Agent.cp.on('close', (exitCode, signal) => {
                    resolve(true);
                });
                setTimeout(() => resolve(false), Agent.EXIT_TIMEOUT);
            });
        }
        return Promise.resolve(true);
    }
}
Agent.agentBinariesPath = path.join(__filename, '..', '..', '..', 'dotnet_modules');
Agent.EXIT_TIMEOUT = 1000;
exports.Agent = Agent;

//# sourceMappingURL=agent.js.map
