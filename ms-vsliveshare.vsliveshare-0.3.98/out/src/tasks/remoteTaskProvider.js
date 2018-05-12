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
const url = require("url");
const vscode = require("vscode");
const agent_1 = require("../agent");
const config = require("../config");
const liveShareTaskType = 'vsls';
let internalContext;
function register() {
    const taskProvider = vscode.workspace.registerTaskProvider('vsls', {
        provideTasks: () => {
            return getWorkspaceTasks();
        },
        resolveTask(task) {
            return undefined;
        }
    });
    return taskProvider;
}
exports.register = register;
function configure(token, fetchTasks) {
    internalContext = {
        brokerToken: token,
        fetchTasks: fetchTasks,
        taskCache: {},
        dispose: () => {
            internalContext = undefined;
        }
    };
    return internalContext;
}
exports.configure = configure;
function getWorkspaceTasks() {
    return __awaiter(this, void 0, void 0, function* () {
        const result = [];
        if (internalContext === undefined) {
            return result;
        }
        if (!agent_1.Agent.IsRunning) {
            return result;
        }
        const diagnosticLogging = config.get(config.Key.diagnosticLogging);
        const loggingArgs = diagnosticLogging ? ['--verbosity', 'Warning'] : [];
        const brokerArgs = [
            '--broker-token',
            internalContext.brokerToken,
            '--agent-uri',
            url.format(agent_1.Agent.uri)
        ];
        const tasksOnHost = yield internalContext.fetchTasks();
        for (const taskOnHost of tasksOnHost.filter(x => x.uniqueId && x.name)) {
            let task;
            const stats = internalContext.taskCache[taskOnHost.uniqueId];
            if (stats && stats.pendingHostExecutions && stats.pendingHostExecutions.length) {
                // create a workspace task to monitor a task execution on the host
                const kind = {
                    type: 'vsls',
                    taskUid: taskOnHost.uniqueId,
                    executionId: stats.pendingHostExecutions[0]
                };
                task = new vscode.Task(kind, taskOnHost.name, taskOnHost.source ? taskOnHost.source : 'Shared', new vscode.ProcessExecution(agent_1.Agent.getAgentPath(), [
                    ...loggingArgs,
                    'monitor-task',
                    taskOnHost.uniqueId,
                    '--execution-id',
                    kind.executionId,
                    ...brokerArgs
                ]));
            }
            else {
                // create a workspace task to run a task on the host
                const kind = {
                    type: 'vsls',
                    taskUid: taskOnHost.uniqueId
                };
                task = new vscode.Task(kind, taskOnHost.name, taskOnHost.source ? taskOnHost.source : 'Shared', new vscode.ProcessExecution(agent_1.Agent.getAgentPath(), [
                    ...loggingArgs,
                    'run-task',
                    taskOnHost.uniqueId,
                    ...brokerArgs
                ]));
            }
            switch (taskOnHost.kind) {
                case 'build':
                    task.group = vscode.TaskGroup.Build;
                    break;
                case 'clean':
                    task.group = vscode.TaskGroup.Clean;
                    break;
                case 'rebuild':
                    task.group = vscode.TaskGroup.Rebuild;
                    break;
                case 'task':
                    task.group = vscode.TaskGroup.Test;
                    break;
                default:
                    break;
            }
            task.presentationOptions = {
                reveal: vscode.TaskRevealKind.Always,
                echo: diagnosticLogging,
                focus: true,
                panel: vscode.TaskPanelKind.Shared
            };
            task.isBackground = false;
            task.problemMatchers = ['$vsls'];
            result.push(task);
        }
        return result;
    });
}

//# sourceMappingURL=remoteTaskProvider.js.map
