"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const path = require("path");
const util = require("../util");
const os = require("os");
const launcher_1 = require("../launcher");
/*
Class helper to implement a custom DebugAdapterExecutable instance that would pass addtional arguments
to our debug host adapter
*/
class AdapterExecutableProvider {
    constructor(debugAdapterAssembly) {
        this.debugAdapterAssembly = debugAdapterAssembly;
    }
    debugAdapterExecutable(folder, token) {
        let adapterBinPath = path.join(launcher_1.Launcher.extensionRootPath, 'dotnet_modules', this.debugAdapterAssembly);
        if (os.platform() === util.OSPlatform.WINDOWS) {
            adapterBinPath += '.exe';
        }
        return new vscode.DebugAdapterExecutable(adapterBinPath, this.adapterArguments);
    }
}
exports.AdapterExecutableProvider = AdapterExecutableProvider;

//# sourceMappingURL=adapterExecutableProvider.js.map
