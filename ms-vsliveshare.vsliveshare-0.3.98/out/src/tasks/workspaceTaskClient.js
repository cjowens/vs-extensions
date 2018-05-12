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
const semver = require("semver");
const config = require("../config");
const service_1 = require("../workspace/service");
const wm = require("../workspace/contract/WorkspaceServiceTypes");
const RemoteTaskProvider = require("./remoteTaskProvider");
const traceSource_1 = require("../tracing/traceSource");
let workspaceTaskClient;
function enable(rpcClient, workspaceService) {
    return __awaiter(this, void 0, void 0, function* () {
        if (config.featureFlags.workspaceTask) {
            if (semver.gte(semver.coerce(vscode.version), '1.23.0')) {
                workspaceTaskClient = new WorkspaceTaskClient(rpcClient, workspaceService);
                yield workspaceTaskClient.initialize();
            }
        }
    });
}
exports.enable = enable;
function disable() {
    return __awaiter(this, void 0, void 0, function* () {
        if (workspaceTaskClient) {
            yield workspaceTaskClient.dispose();
            workspaceTaskClient = undefined;
        }
    });
}
exports.disable = disable;
class WorkspaceTaskClient {
    constructor(rpcClient, workspaceService) {
        this.rpcClient = rpcClient;
        this.workspaceService = workspaceService;
        this.subscriptions = [];
        this.deferredInit = Promise.resolve();
        this.workspaceTaskService = new service_1.WorkspaceTaskService(this.rpcClient);
        this.brokerManagerService = new service_1.BrokerManagerService(this.rpcClient);
        this.taskBrokerService = new service_1.TaskBrokerService(this.rpcClient);
        this.trace = traceSource_1.traceSource.withName('WorkspaceTaskClient');
    }
    get stats() {
        return this.taskManagerContext.taskCache;
    }
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.workspaceService.registerServicesAsync(['taskBroker'], wm.WorkspaceServicesChangeType.Add);
            this.subscriptions.push(vscode_1.workspace.onDidStartTask(e => this.handleWorkspaceTaskStarted(e.execution)), vscode_1.workspace.onDidEndTask(e => this.handleWorkspaceTaskEnded(e.execution)));
            this.workspaceTaskService.onTaskStarted(e => this.handleHostTaskStarted(e.taskExecution));
            this.taskBrokerService.onTaskExecutionHandled(e => this.handleTaskExecutionHandled(e.taskExecution));
            this.deferredInit = this.initializeContext();
        });
    }
    initializeContext() {
        return __awaiter(this, void 0, void 0, function* () {
            const brokerToken = yield this.brokerManagerService.register({
                hostServices: ['workspaceTask', 'taskOutputStream'],
                guestServices: ['taskBroker']
            });
            this.taskManagerContext = RemoteTaskProvider.configure(brokerToken, () => __awaiter(this, void 0, void 0, function* () {
                try {
                    const tasksOnHost = (yield this.workspaceTaskService.getSupportedTasks()) || [];
                    return tasksOnHost;
                }
                catch (_a) {
                    return [];
                }
            }));
            let hostTasks = [];
            let hostTaskExecutions = [];
            try {
                hostTasks = (yield this.workspaceTaskService.getSupportedTasks()) || [];
                hostTaskExecutions = (yield this.workspaceTaskService.getTaskExecutions()) || [];
            }
            catch (_b) { }
            for (const hostTask of hostTasks) {
                const executions = hostTaskExecutions
                    .filter(x => x.taskUid === hostTask.uniqueId)
                    .map(x => x.id);
                this.taskManagerContext.taskCache[hostTask.uniqueId] = {
                    pendingHostExecutions: executions
                };
            }
            const fetched = (yield vscode_1.workspace.fetchTasks()) || [];
            for (const workspaceTask of fetched.filter(x => x.definition.type === 'vsls')) {
                const taskUid = WorkspaceTaskClient.getTaskUid(workspaceTask);
                const taskInfo = this.stats[taskUid];
                if (taskInfo &&
                    taskInfo.pendingHostExecutions &&
                    taskInfo.pendingHostExecutions.length) {
                    taskInfo.currentGuestExecution = yield vscode_1.workspace.executeTask(workspaceTask);
                }
            }
        });
    }
    handleWorkspaceTaskStarted(execution) {
        const taskDef = WorkspaceTaskClient.getTaskDefinition(execution.task);
        if (taskDef) {
            const taskInfo = this.stats[taskDef.taskUid];
            taskInfo.currentGuestExecution = execution;
            if (taskDef.executionId) {
                // if the task is monitoring only, remove from pending executions
                const index = taskInfo.pendingHostExecutions.indexOf(taskDef.executionId);
                if (index > -1) {
                    // task execution reported by the host
                    taskInfo.pendingHostExecutions.splice(index, 1);
                }
            }
        }
    }
    handleWorkspaceTaskEnded(execution) {
        return __awaiter(this, void 0, void 0, function* () {
            const taskUid = WorkspaceTaskClient.getTaskUid(execution.task);
            const taskInfo = taskUid ? this.stats[taskUid] : undefined;
            if (taskInfo && taskInfo.currentGuestExecution === execution) {
                taskInfo.currentGuestExecution = undefined;
                // start a new task execution if there's a pending request
                if (taskInfo.pendingHostExecutions && taskInfo.pendingHostExecutions.length) {
                    this.executeTask(taskUid);
                }
            }
        });
    }
    handleHostTaskStarted(execution) {
        return __awaiter(this, void 0, void 0, function* () {
            const taskUid = execution.taskUid;
            let taskInfo = this.stats[taskUid];
            const index = taskInfo ? taskInfo.pendingHostExecutions.indexOf(execution.id) : -1;
            if (index > -1) {
                // task execution reported by the broker
                taskInfo.pendingHostExecutions.splice(index, 1);
            }
            else {
                // task execution reported by the host
                if (taskInfo) {
                    taskInfo.pendingHostExecutions.push(execution.id);
                }
                else {
                    taskInfo = {
                        pendingHostExecutions: [execution.id]
                    };
                    this.stats[taskUid] = taskInfo;
                }
                if (!taskInfo.currentGuestExecution) {
                    taskInfo.currentGuestExecution = yield this.executeTask(taskUid);
                }
            }
        });
    }
    handleTaskExecutionHandled(execution) {
        let taskInfo = this.stats[execution.taskUid];
        const index = taskInfo ? taskInfo.pendingHostExecutions.indexOf(execution.id) : -1;
        if (index > -1) {
            // task execution reported by the host
            taskInfo.pendingHostExecutions.splice(index, 1);
        }
        else {
            // task execution reported by the broker for the first time
            if (taskInfo) {
                taskInfo.pendingHostExecutions.push(execution.id);
            }
            else {
                taskInfo = {
                    pendingHostExecutions: [execution.id]
                };
                this.stats[execution.taskUid] = taskInfo;
            }
        }
    }
    static getTaskDefinition(task) {
        if (task.definition.type === 'vsls') {
            return task.definition;
        }
        return undefined;
    }
    static getTaskUid(task) {
        if (task.definition.type === 'vsls') {
            const taskDef = task.definition;
            return taskDef.taskUid;
        }
        return undefined;
    }
    executeTask(taskUid) {
        return __awaiter(this, void 0, void 0, function* () {
            const fetched = (yield vscode_1.workspace.fetchTasks()) || [];
            for (const workspaceTask of fetched.filter(x => x.definition.type === 'vsls')) {
                if (WorkspaceTaskClient.getTaskUid(workspaceTask) === taskUid) {
                    return vscode_1.workspace.executeTask(workspaceTask);
                }
            }
            return undefined;
        });
    }
    dispose() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.deferredInit;
            }
            catch (_a) { }
            this.isDisposed = true;
            if (this.taskManagerContext) {
                this.taskManagerContext.dispose();
            }
            this.subscriptions.forEach(d => d.dispose());
            try {
                yield this.workspaceService.registerServicesAsync(['taskBroker'], wm.WorkspaceServicesChangeType.Remove);
            }
            catch (_b) { }
        });
    }
}

//# sourceMappingURL=workspaceTaskClient.js.map
