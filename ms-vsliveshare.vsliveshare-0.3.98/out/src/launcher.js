"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
const fs = require("fs");
const path = require("path");
const os = require("os");
const traceSource_1 = require("./tracing/traceSource");
const util_1 = require("./util");
const child_process = require("child_process");
const process = require("process");
const vscode = require("vscode");
const config = require("./config");
const util = require("./util");
const clipboardy_1 = require("clipboardy");
/**
 * Interacts with the Cascade VSCode launcher.
 */
class Launcher {
    /**
     * Installs and starts the launcher. Returns `true` if installation succeeded.
     */
    static run(userInitiated, installInitiated = false) {
        const [command, args, runManually] = Launcher.getLauncherCommand(userInitiated, installInitiated);
        if (!command) {
            // Launcher probably already set up.
            // TODO: be more explicit about this and show notification to user
            // Right now, the default "Launcher successfully installed" message will show.
            return true;
        }
        if (runManually && (config.get(config.Key.showLauncherInstallNotification) || userInitiated)) {
            this.presentSudoTerminalCommand(`${command} ${args.join(' ')}`, userInitiated);
            // Do not assume that the launcher has been installed
            return false;
        }
        let cp = child_process.spawn(command, args);
        cp.stdout.on('data', (data) => {
            Launcher.trace.verbose(data.toString().trim());
        });
        cp.stderr.on('data', (data) => {
            Launcher.trace.error(data.toString().trim());
        });
        cp.on('error', (err) => {
            Launcher.trace.error('Launcher failed with error: ' + err);
        });
        cp.on('close', (exitCode, signal) => {
            Launcher.trace.info('Launcher terminated with exit code: ' + exitCode + ' and signal ' + signal);
        });
        return true;
    }
    static presentSudoTerminalCommand(command, userInitiated = false) {
        return __awaiter(this, void 0, void 0, function* () {
            const terminal = vscode.window.createTerminal(`VS Live Share`);
            const commandSequence = [
                'clear',
                command,
                'echo "Press enter to close the terminal window."',
                'sync',
                'read',
                'exit 0'
            ].join(' && ');
            terminal.show();
            terminal.sendText(commandSequence, /* addNewLine (executes command) */ true);
            const copyInsteadResponse = 'Copy instead';
            const neverShowAgainResponse = 'Never show again';
            const result = yield vscode.window.showInformationMessage('To complete Visual Studio Live Share\'s browser integration, please enter your admin (sudo) password in the opened terminal window.', { title: copyInsteadResponse }, !userInitiated ? { title: neverShowAgainResponse } : undefined);
            if (!result) {
                return;
            }
            switch (result.title) {
                case copyInsteadResponse:
                    yield clipboardy_1.write(command);
                    yield vscode.window.showInformationMessage('The Live Share browser integration install command was copied to your clipboard.');
                    terminal.dispose();
                    break;
                case neverShowAgainResponse:
                    config.save(config.Key.showLauncherInstallNotification, false);
                    yield vscode.window.showInformationMessage('You can run the "Live Share Launcher Setup" command to complete the integration later.');
                    terminal.dispose();
                    break;
                default:
                    break;
            }
        });
    }
    /**
     * Writes to external/launcher/codepath.json
     */
    static writeVSCodeCLIPath() {
        const programPath = process.argv0;
        const cliPath = Launcher.getCLIPath();
        const isNewWindow = config.get(config.Key.joinInNewWindow) || false;
        const vscodeInfo = { cliPath, programPath, isNewWindow };
        const jsonContent = JSON.stringify(vscodeInfo);
        // write to file
        return util_1.ExtensionUtil.writeFile(Launcher.codeCLIPathFile, jsonContent);
    }
    static getCLIPath() {
        switch (os.platform()) {
            case util_1.OSPlatform.WINDOWS: {
                let codeDir = path.dirname(process.argv0);
                let binDir = path.join(codeDir, 'bin');
                let binFiles = fs.readdirSync(binDir);
                let cmdPath = binFiles.find(((value, index, obj) => {
                    // the cli path is different in different flavours of VSCode (ex. code.cmd, code-insiders.cmd, etc)
                    // identify the cli path from the extension rather than the name
                    return path.parse(value).ext === '.cmd';
                }));
                return path.join(binDir, cmdPath);
            }
            case util_1.OSPlatform.MACOS: {
                let exePath = process.argv0;
                let appExtension = '.app';
                let appPathEndIndex = exePath.indexOf(appExtension) + appExtension.length;
                let appPath = exePath.substring(0, appPathEndIndex);
                return path.join(appPath, 'Contents', 'Resources', 'app', 'bin', 'code');
            }
            case util_1.OSPlatform.LINUX:
            default:
                return process.execPath;
        }
    }
    static getLauncherCommand(userInitiated, installInitiated = false) {
        switch (os.platform()) {
            case util_1.OSPlatform.WINDOWS: {
                const exePath = path.join(Launcher.launcherWinPath, config.get(config.Key.launcherName) + '.exe');
                return [exePath, [], false];
            }
            case util_1.OSPlatform.MACOS: {
                const appPath = path.join(Launcher.launcherOSXPath, config.get(config.Key.launcherName) + '.app');
                const args = [appPath, '--args', '-Register'];
                if (userInitiated) {
                    args.push('-UserInitiated');
                }
                args.push('--extensionRoot', Launcher.extensionRootPath);
                return ['open', args, false];
            }
            default:
            case util_1.OSPlatform.LINUX: {
                const envHome = 'HOME';
                const envXDGDataHome = 'XDG_DATA_HOME';
                // Launcher install location varies - figure out where it should be
                let installRoot = path.join(process.env[envHome], '.local', 'share');
                let sudoRequired = false;
                if (process.env[envXDGDataHome]) {
                    installRoot = process.env[envXDGDataHome];
                    // CentOS is on Linux Kernel v3 while anything after 2015 is on Kernel v4.
                    // os.release()[0] === '3' checks for the kernel version.
                    // This forces CentOS on the terminal path, since there are issues with using .local/ in CentOS.
                }
                else if (os.release()[0] === '3' || !fs.existsSync(installRoot)) {
                    installRoot = path.normalize('/usr/local/share');
                }
                // Check if the resulting path us usr/local/share either from XDG_DATA_HOME or our own settings
                if (installRoot === path.normalize('/usr/local/share')) {
                    sudoRequired = true;
                }
                const scriptPath = path.join(Launcher.launcherLinuxPath, 'install.sh');
                const desktopFilePath = path.join(Launcher.launcherLinuxPath, 'vsls-launcher.desktop');
                const desktopFileInstallPath = path.join(installRoot, 'applications', 'vsls-launcher.desktop');
                const versionRegex = /X-Version=(.*)/;
                // Don't prompt user to install launcher if already installed,
                // unless user manually wants to reinstall launcher or versions don't match
                // or extension reinstalled (or upgraded)
                if (!userInitiated && !installInitiated && fs.existsSync(desktopFileInstallPath)) {
                    const currentVersion = fs.readFileSync(desktopFilePath, 'utf-8').match(versionRegex);
                    const installedVersion = fs.readFileSync(desktopFileInstallPath, 'utf-8').match(versionRegex);
                    // If versions match, don't prompt user to reinstall launcher.
                    if (currentVersion
                        && installedVersion
                        && currentVersion[1] === installedVersion[1]) {
                        return ['', [], false];
                    }
                }
                // Prompt for the manual terminal command if sudo is required
                return ['bash', [scriptPath, Launcher.codeCLIPathFile, installRoot, sudoRequired ? 'true' : ''], sudoRequired];
            }
        }
    }
    static setup(userInitiated = false, installInitiated = false) {
        return __awaiter(this, void 0, void 0, function* () {
            const errorMessageTranslocated = `${config.get(config.Key.shortName)}: You are running VS Code outside the Applications folder so we can't setup support for joining by clicking on links from a browser.`;
            const errorMessageGeneric = `${config.get(config.Key.shortName)}: Could not register the launcher that supports joining by clicking on links from a browser. `;
            try {
                // Can happen due to app translocation when the app has not been moved from Downloads, and the app path is randomized and read only
                if (Launcher.isAppTranslocated && (config.get(config.Key.showLauncherError) || userInitiated)) {
                    yield Launcher.displayLauncherSetupError(errorMessageTranslocated);
                }
                else {
                    yield Launcher.writeVSCodeCLIPath();
                    const success = Launcher.run(userInitiated, installInitiated); /* registers the protocol handler */
                    config.save(config.Key.showLauncherError, false);
                    if (userInitiated && success) {
                        yield vscode.window.showInformationMessage('Launcher successfully set up.');
                    }
                }
            }
            catch (e) {
                Launcher.trace.error('Could not register the launcher. Error: ' + e);
                if (config.get(config.Key.showLauncherError) || userInitiated) {
                    yield Launcher.displayLauncherSetupError(errorMessageGeneric);
                }
            }
        });
    }
    static displayLauncherSetupError(message) {
        return __awaiter(this, void 0, void 0, function* () {
            // setup the launcher
            const neverShowAgain = { title: 'Never show again' };
            const moreInfo = { title: 'Learn more' };
            let option = yield vscode.window.showErrorMessage(message, moreInfo, neverShowAgain);
            if (option === moreInfo) {
                util_1.ExtensionUtil.openBrowser(Launcher.manualJoinUrl);
            }
            if (option === neverShowAgain) {
                config.save(config.Key.showLauncherError, false);
            }
        });
    }
    static get isAppTranslocated() {
        return os.platform() === util.OSPlatform.MACOS && Launcher.getCLIPath().startsWith('/private/var');
    }
    static readFileContents(filePath) {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (error, data) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve(data);
                }
            });
        });
    }
}
Launcher.extensionRootPath = path.join(__filename, '..', '..', '..');
Launcher.nodeModulesPath = path.join(Launcher.extensionRootPath, 'node_modules');
Launcher.launcherOSXPath = path.join(Launcher.nodeModulesPath, '@vsliveshare', 'vscode-launcher-osx');
Launcher.launcherWinPath = path.join(Launcher.nodeModulesPath, '@vsliveshare', 'vscode-launcher-win');
Launcher.launcherLinuxPath = path.join(Launcher.nodeModulesPath, '@vsliveshare', 'vscode-launcher-linux');
Launcher.codeCLIPathFile = path.join(Launcher.extensionRootPath, 'codepath.json');
Launcher.trace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientLauncher);
Launcher.manualJoinUrl = 'https://aka.ms/vsls/manual-join';
Launcher.JOIN_FILE_LIFESPAN = 30 * 1000;
exports.Launcher = Launcher;

//# sourceMappingURL=launcher.js.map
