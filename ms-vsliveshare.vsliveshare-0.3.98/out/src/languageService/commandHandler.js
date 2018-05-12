"use strict";
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
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
const vscodeLSP = require("vscode-languageclient");
const REMOTE_COMMAND_NAME = '_liveshare.remotecommand';
const localCommands = ['vscode.open'];
/**
 * Some VSCode commands have constraints on their parameters and validate the types at runtime.
 * For paratmers of type Uri lose their type identity when serialized to JSON and re-hydrated.
 * So for the vscode commands where constraints are enforced, we need to handle the serialization and deserialization.
 * The list of VS Code commands with their constraints is here - https://github.com/Microsoft/vscode/blob/master/src/vs/workbench/api/node/extHostApiCommands.ts
 */
function withProtocolArguments(command, c2pConverter) {
    if (command.command === 'vscode.open') {
        let uri = command.arguments[0];
        command.arguments[0] = c2pConverter.asUri(uri);
    }
    return command;
}
function withCodeArguments(command, p2cConverter) {
    if (command.command === 'vscode.open') {
        let uri = command.arguments[0];
        command.arguments[0] = p2cConverter.asUri(uri);
    }
    return command;
}
/**
 * Wrap the given vscode command as the argument of a specific REMOTE_COMMAND_NAME for which the guest registers a handler.
 * The handler knows to either send the command back to the host or execute locally on the guest.
 */
function wrapCommand(command, c2pConverter) {
    let remoteCommand = {
        title: command.title,
        command: REMOTE_COMMAND_NAME,
        tooltip: command.tooltip,
        arguments: [withProtocolArguments(command, c2pConverter)]
    };
    return c2pConverter.asCommand(remoteCommand);
}
exports.wrapCommand = wrapCommand;
/**
 * VS Code 1.20 and above can return either a command or a codeaction from codeactionproviders. The languageclient library
 * hasn't been updated yet to understand this. To workaround, we send the codeaction as an argument to a wrapped command and the command
 * handler on the guest side knows to apply the codeaction.
 */
function wrapCommandOrCodeAction(commandOrCodeAction, c2pConverter, c2pExt) {
    // This is a command
    if (commandOrCodeAction.command !== undefined) {
        let command = commandOrCodeAction;
        return wrapCommand(command, c2pConverter);
    }
    else if (commandOrCodeAction.edit !== undefined) {
        // This is a codeaction. Wrap the codeaction in a remote command. 
        let codeAction = commandOrCodeAction;
        codeAction.edit = c2pExt.asWorkspaceEdit(commandOrCodeAction.edit);
        let remoteCommand = {
            title: codeAction.title,
            command: REMOTE_COMMAND_NAME,
            tooltip: codeAction.tooltip,
            arguments: [codeAction]
        };
        return c2pConverter.asCommand(remoteCommand);
    }
    else {
        throw new Error('Unknown codeaction type');
    }
}
exports.wrapCommandOrCodeAction = wrapCommandOrCodeAction;
/**
 * The handler for the LiveShare remote command that knows to either run a command locally or send it to the host for execution.
 * These are commands returned for codeactions or codelenses.
 */
function handleLiveShareRemoteCommand(args, lspClient, p2cConverter) {
    return __awaiter(this, void 0, void 0, function* () {
        // We expect a single argument. In VSCode 1.20 and above this can either be a command or codeaction which contains edits (for codeactions). 
        // VSCode's package and LSP havent been updated with this change. So we handle this dynamically here.
        if (args.command !== undefined) {
            let command = args;
            // Some commands will be run locally and for some we send back to the host.
            if (localCommands.indexOf(command.command) >= 0) {
                command = withCodeArguments(command, p2cConverter);
                let commandArgs = command.arguments || [];
                vscode.commands.executeCommand(command.command, ...commandArgs);
            }
            else {
                let params = {
                    command: command.command,
                    arguments: command.arguments
                };
                yield lspClient.sendRequest(vscodeLSP.ExecuteCommandRequest.type, params);
            }
        }
        else if (args.edit !== undefined) {
            let workspaceEdit = args.edit;
            vscode.workspace.applyEdit(p2cConverter.asWorkspaceEdit(workspaceEdit));
        }
    });
}
exports.handleLiveShareRemoteCommand = handleLiveShareRemoteCommand;

//# sourceMappingURL=commandHandler.js.map
