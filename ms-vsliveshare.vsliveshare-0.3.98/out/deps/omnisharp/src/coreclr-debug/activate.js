/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
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
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const common = require("./../common");
const util_1 = require("./util");
const logger_1 = require("./../logger");
const platform_1 = require("./../platform");
let _debugUtil = null;
let _logger = null;
function activate(thisExtension, context, reporter, logger, channel) {
    return __awaiter(this, void 0, void 0, function* () {
        _debugUtil = new util_1.CoreClrDebugUtil(context.extensionPath, logger);
        _logger = logger;
        if (!util_1.CoreClrDebugUtil.existsSync(_debugUtil.debugAdapterDir())) {
            let platformInformation;
            try {
                platformInformation = yield platform_1.PlatformInformation.GetCurrent();
            }
            catch (err) {
                // Somehow we couldn't figure out the platform we are on
                logger.appendLine("[ERROR]: C# Extension failed to install the debugger package");
                showInstallErrorMessage(channel);
            }
            if (platformInformation) {
                if (platformInformation.architecture !== "x86_64") {
                    if (platformInformation.isWindows() && platformInformation.architecture === "x86") {
                        logger.appendLine(`[WARNING]: x86 Windows is not currently supported by the .NET Core debugger. Debugging will not be available.`);
                    }
                    else {
                        logger.appendLine(`[WARNING]: Processor architecture '${platformInformation.architecture}' is not currently supported by the .NET Core debugger. Debugging will not be available.`);
                    }
                }
                else {
                    logger.appendLine("[ERROR]: C# Extension failed to install the debugger package");
                    showInstallErrorMessage(channel);
                }
            }
        }
        else if (!util_1.CoreClrDebugUtil.existsSync(_debugUtil.installCompleteFilePath())) {
            completeDebuggerInstall(logger, channel);
        }
    });
}
exports.activate = activate;
function completeDebuggerInstall(logger, channel) {
    return __awaiter(this, void 0, void 0, function* () {
        return _debugUtil.checkDotNetCli()
            .then((dotnetInfo) => {
            if (os.platform() === "darwin" && !util_1.CoreClrDebugUtil.isMacOSSupported()) {
                logger.appendLine("[ERROR] The debugger cannot be installed. The debugger requires macOS 10.12 (Sierra) or newer.");
                channel.show();
                return false;
            }
            // Write install.complete
            util_1.CoreClrDebugUtil.writeEmptyFile(_debugUtil.installCompleteFilePath());
            vscode.window.setStatusBarMessage('Successfully installed .NET Core Debugger.', 5000);
            return true;
        }, (err) => {
            // Check for dotnet tools failed. pop the UI
            // err is a DotNetCliError but use defaults in the unexpected case that it's not
            showDotnetToolsWarning(err.ErrorMessage || _debugUtil.defaultDotNetCliErrorMessage());
            _logger.appendLine(err.ErrorString || err);
            // TODO: log telemetry?
            return false;
        });
    });
}
function showInstallErrorMessage(channel) {
    channel.show();
    vscode.window.showErrorMessage("An error occured during installation of the .NET Core Debugger. The C# extension may need to be reinstalled.");
}
function showDotnetToolsWarning(message) {
    const config = vscode.workspace.getConfiguration('csharp');
    if (!config.get('suppressDotnetInstallWarning', false)) {
        const getDotNetMessage = 'Get .NET CLI tools';
        const goToSettingsMessage = 'Disable this message in user settings';
        // Buttons are shown in right-to-left order, with a close button to the right of everything;
        // getDotNetMessage will be the first button, then goToSettingsMessage, then the close button.
        vscode.window.showErrorMessage(message, goToSettingsMessage, getDotNetMessage).then(value => {
            if (value === getDotNetMessage) {
                let open = require('open');
                let dotnetcoreURL = 'https://www.microsoft.com/net/core';
                // Windows redirects https://www.microsoft.com/net/core to https://www.microsoft.com/net/core#windowsvs2015
                if (process.platform == "win32") {
                    dotnetcoreURL = dotnetcoreURL + '#windowscmd';
                }
                open(dotnetcoreURL);
            }
            else if (value === goToSettingsMessage) {
                vscode.commands.executeCommand('workbench.action.openGlobalSettings');
            }
        });
    }
}
// The default extension manifest calls this command as the adapterExecutableCommand
// If the debugger components have not finished downloading, the proxy displays an error message to the user
// Else it will launch the debug adapter
function getAdapterExecutionCommand(channel) {
    return __awaiter(this, void 0, void 0, function* () {
        let logger = new logger_1.Logger(text => channel.append(text));
        let util = new util_1.CoreClrDebugUtil(common.getExtensionPath(), logger);
        // Check for .debugger folder. Handle if it does not exist.
        if (!util_1.CoreClrDebugUtil.existsSync(util.debugAdapterDir())) {
            // our install.complete file does not exist yet, meaning we have not completed the installation. Try to figure out what if anything the package manager is doing
            // the order in which files are dealt with is this:
            // 1. install.Begin is created
            // 2. install.Lock is created
            // 3. install.Begin is deleted
            // 4. install.complete is created
            // install.Lock does not exist, need to wait for packages to finish downloading.
            let installLock = yield common.installFileExists(common.InstallFileType.Lock);
            if (!installLock) {
                channel.show();
                throw new Error('The C# extension is still downloading packages. Please see progress in the output window below.');
            }
            else if (!util_1.CoreClrDebugUtil.existsSync(util.installCompleteFilePath())) {
                let success = yield completeDebuggerInstall(logger, channel);
                if (!success) {
                    channel.show();
                    throw new Error('Failed to complete the installation of the C# extension. Please see the error in the output window below.');
                }
            }
        }
        // debugger has finished install, kick off our debugger process
        return {
            command: path.join(common.getExtensionPath(), ".debugger", "vsdbg-ui" + util_1.CoreClrDebugUtil.getPlatformExeExtension())
        };
    });
}
exports.getAdapterExecutionCommand = getAdapterExecutionCommand;

//# sourceMappingURL=activate.js.map
