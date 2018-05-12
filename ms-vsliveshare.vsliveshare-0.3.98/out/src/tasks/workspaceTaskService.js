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
const vscode = require("vscode");
const vscode_1 = require("vscode");
const vscode_jsonrpc_1 = require("vscode-jsonrpc");
const semver = require("semver");
const config = require("../config");
const wm = require("../workspace/contract/WorkspaceServiceTypes");
const wt = require("../workspace/contract/WorkspaceTaskServiceTypes");
const traceSource_1 = require("../tracing/traceSource");
const remoteServiceTelemetry_1 = require("../telemetry/remoteServiceTelemetry");
const workspaceTaskTelemetry_1 = require("./workspaceTaskTelemetry");
let workspaceTaskService;
function enable(rpcClient, workspaceService) {
    return __awaiter(this, void 0, void 0, function* () {
        if (config.featureFlags.workspaceTask) {
            if (semver.gte(semver.coerce(vscode.version), '1.23.0')) {
                workspaceTaskService = new WorkspaceTaskService(rpcClient, workspaceService);
                yield workspaceTaskService.initialize();
            }
        }
    });
}
exports.enable = enable;
function disable() {
    return __awaiter(this, void 0, void 0, function* () {
        if (workspaceTaskService) {
            yield workspaceTaskService.dispose();
            workspaceTaskService = undefined;
        }
    });
}
exports.disable = disable;
class WorkspaceTaskService {
    constructor(rpcClient, workspaceService) {
        this.rpcClient = rpcClient;
        this.workspaceService = workspaceService;
        this.subscriptions = [];
        this.taskExecutions = [];
        this.completedExecutions = [];
        this.trace = traceSource_1.traceSource.withName('WorkspaceTaskService');
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            this.rpcClient.addRequestMethod('workspaceTask.getSupportedTasks', (cancellationToken) => this.getSupportedTasks());
            this.rpcClient.addRequestMethod('workspaceTask.getTaskExecutions', (cancellationToken) => this.getTaskExecutions());
            this.rpcClient.addRequestMethod('workspaceTask.runTask', (taskNameOrUid, cancellationToken) => this.runTask(taskNameOrUid));
            this.rpcClient.addRequestMethod('workspaceTask.terminateTask', (taskExecution, cancellationToken) => this.terminateTask(taskExecution));
            this.rpcClient.addRequestMethod('taskOutputStream.getStream', (...params) => {
                // No task output streaming is supported yet
                return null;
            });
            yield this.workspaceService.registerServicesAsync(['workspaceTask', 'taskOutputStream'], wm.WorkspaceServicesChangeType.Add);
            this.subscriptions.push(vscode_1.workspace.onDidStartTask(e => this.handleTaskStarted(e.execution)), vscode_1.workspace.onDidEndTask(e => this.handleTaskEnded(e.execution)));
        });
    }
    dispose() {
        return __awaiter(this, void 0, void 0, function* () {
            this.isDisposed = true;
            this.subscriptions.forEach(d => d.dispose());
            yield this.workspaceService.registerServicesAsync(['workspaceTask', 'taskOutputStream'], wm.WorkspaceServicesChangeType.Remove);
            this.rpcClient.removeRequestMethod('workspacetask.getSupportedTasks');
            this.rpcClient.removeRequestMethod('workspacetask.getTaskExecutions');
            this.rpcClient.removeRequestMethod('workspacetask.runTask');
            this.rpcClient.removeRequestMethod('workspacetask.terminateTask');
            this.rpcClient.removeRequestMethod('taskOutputStream.getStream');
            const v0 = {};
            const executionsByKind = this.completedExecutions.reduce((ebk, entry) => (Object.assign({}, ebk, { [entry[0]]: [...(ebk[entry[0]] || []), entry[1]] })), v0);
            Object.keys(executionsByKind).forEach(taskKind => {
                workspaceTaskTelemetry_1.WorkspaceTaskTelemetry.sendExecutionSummary(taskKind, executionsByKind[taskKind]);
            });
        });
    }
    getSupportedTasks() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const tasks = yield vscode_1.workspace.fetchTasks();
                const workspaceTasks = tasks.map(x => {
                    return {
                        uniqueId: this.getTaskUid(x),
                        name: x.name,
                        source: x.source,
                        kind: this.getTaskKind(x)
                    };
                });
                return workspaceTasks;
            }
            catch (error) {
                remoteServiceTelemetry_1.RemoteServiceTelemetry.sendServiceFault(WorkspaceTaskService.SERVICE_NAME, 'getSupportedTasks', error);
                return new vscode_jsonrpc_1.ResponseError(vscode_jsonrpc_1.ErrorCodes.UnknownErrorCode, error.message, error.stack);
            }
        });
    }
    getTaskExecutions() {
        try {
            return Promise.resolve(this.taskExecutions.map(x => x[0]));
        }
        catch (error) {
            remoteServiceTelemetry_1.RemoteServiceTelemetry.sendServiceFault(WorkspaceTaskService.SERVICE_NAME, 'getTaskExecutions', error);
            return new vscode_jsonrpc_1.ResponseError(vscode_jsonrpc_1.ErrorCodes.UnknownErrorCode, error.message, error.stack);
        }
    }
    runTask(taskUidOrName) {
        return __awaiter(this, void 0, void 0, function* () {
            let result = { status: wt.RunTaskStatus.TaskNotFound };
            try {
                const tasks = yield vscode_1.workspace.fetchTasks();
                const matchingTasks = tasks.filter(x => x.name === taskUidOrName || this.getTaskUid(x) === taskUidOrName);
                if (matchingTasks.length === 1) {
                    const taskToRun = matchingTasks[0];
                    const execution = yield vscode_1.workspace.executeTask(taskToRun);
                    const moniker = this.createMoniker(execution);
                    this.taskExecutions.push([moniker, { execution: execution, startTime: Date.now() }]);
                    result = { status: wt.RunTaskStatus.Started, taskExecution: moniker };
                }
            }
            catch (error) {
                remoteServiceTelemetry_1.RemoteServiceTelemetry.sendServiceFault(WorkspaceTaskService.SERVICE_NAME, 'runTask', error);
                return new vscode_jsonrpc_1.ResponseError(vscode_jsonrpc_1.ErrorCodes.UnknownErrorCode, error.message, error.stack);
            }
            return result;
        });
    }
    terminateTask(taskExecution) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const index = this.taskExecutions.findIndex((x) => x[0] === taskExecution);
                if (index > -1) {
                    const execution = this.taskExecutions[index][1].execution;
                    yield execution.terminate();
                }
            }
            catch (error) {
                remoteServiceTelemetry_1.RemoteServiceTelemetry.sendServiceFault(WorkspaceTaskService.SERVICE_NAME, 'terminateTask', error);
                return new vscode_jsonrpc_1.ResponseError(vscode_jsonrpc_1.ErrorCodes.UnknownErrorCode, error.message, error.stack);
            }
        });
    }
    handleTaskStarted(execution) {
        return __awaiter(this, void 0, void 0, function* () {
            const index = this.taskExecutions.findIndex((x) => x[1].execution === execution);
            let moniker = undefined;
            if (index > -1) {
                // task started by us programmatically
                moniker = this.taskExecutions[index][0];
            }
            else {
                // task started by a user
                moniker = this.createMoniker(execution);
                this.taskExecutions.push([moniker, { execution: execution, startTime: Date.now() }]);
            }
            yield this.rpcClient.sendNotification(this.trace, 'workspaceTask.taskStarted', {
                taskExecution: moniker,
                change: wt.TaskExecutionStatusChange.Started
            });
        });
    }
    handleTaskEnded(execution) {
        return __awaiter(this, void 0, void 0, function* () {
            const taskUid = this.getTaskUid(execution.task);
            const index = this.taskExecutions.findIndex((x) => x[1].execution === execution);
            if (index > -1) {
                const entry = this.taskExecutions[index];
                const kind = this.getTaskKind(entry[1].execution.task) || 'Unknown';
                const elapsed = Date.now() - entry[1].startTime;
                this.completedExecutions.push([kind, elapsed]);
                const moniker = entry[0];
                yield this.rpcClient.sendNotification(this.trace, 'workspaceTask.taskTerminated', {
                    taskExecution: moniker,
                    change: wt.TaskExecutionStatusChange.Terminated
                });
                this.taskExecutions.splice(index, 1);
            }
        });
    }
    getTaskUid(task) {
        return `${task.definition.type}:${task.name}`;
    }
    getTaskKind(task) {
        switch (task.group) {
            case vscode.TaskGroup.Build:
                return 'build';
            case vscode.TaskGroup.Clean:
                return 'clean';
            case vscode.TaskGroup.Rebuild:
                return 'rebuild';
            case vscode.TaskGroup.Test:
                return 'test';
            default:
                return undefined;
        }
    }
    createMoniker(execution) {
        const taskUid = this.getTaskUid(execution.task);
        return {
            id: `${taskUid}:${++WorkspaceTaskService.taskExecutionCounter}`,
            taskUid: taskUid
        };
    }
}
WorkspaceTaskService.SERVICE_NAME = 'workspaceTask';
WorkspaceTaskService.taskExecutionCounter = 0;

//# sourceMappingURL=workspaceTaskService.js.map
