"use strict";
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const process = require("process");
var OperatingSystem;
(function (OperatingSystem) {
    OperatingSystem[OperatingSystem["Unknown"] = 0] = "Unknown";
    OperatingSystem[OperatingSystem["Windows"] = 1] = "Windows";
    OperatingSystem[OperatingSystem["MacOS"] = 2] = "MacOS";
    OperatingSystem[OperatingSystem["Linux"] = 3] = "Linux";
})(OperatingSystem = exports.OperatingSystem || (exports.OperatingSystem = {}));
function getPlatformDetails() {
    let operatingSystem = OperatingSystem.Unknown;
    if (process.platform === "win32") {
        operatingSystem = OperatingSystem.Windows;
    }
    else if (process.platform === "darwin") {
        operatingSystem = OperatingSystem.MacOS;
    }
    else if (process.platform === "linux") {
        operatingSystem = OperatingSystem.Linux;
    }
    const isProcess64Bit = process.arch === "x64";
    return {
        operatingSystem,
        isOS64Bit: isProcess64Bit || process.env.hasOwnProperty("PROCESSOR_ARCHITEW6432"),
        isProcess64Bit,
    };
}
exports.getPlatformDetails = getPlatformDetails;
function getDefaultPowerShellPath(platformDetails, use32Bit = false) {
    let powerShellExePath;
    // Find the path to powershell.exe based on the current platform
    // and the user's desire to run the x86 version of PowerShell
    if (platformDetails.operatingSystem === OperatingSystem.Windows) {
        if (use32Bit) {
            powerShellExePath =
                platformDetails.isOS64Bit && platformDetails.isProcess64Bit
                    ? exports.SysWow64PowerShellPath
                    : exports.System32PowerShellPath;
        }
        else {
            powerShellExePath =
                !platformDetails.isOS64Bit || platformDetails.isProcess64Bit
                    ? exports.System32PowerShellPath
                    : exports.SysnativePowerShellPath;
        }
    }
    else if (platformDetails.operatingSystem === OperatingSystem.MacOS) {
        powerShellExePath = "/usr/local/bin/powershell";
        if (fs.existsSync("/usr/local/bin/pwsh")) {
            powerShellExePath = "/usr/local/bin/pwsh";
        }
    }
    else if (platformDetails.operatingSystem === OperatingSystem.Linux) {
        powerShellExePath = "/usr/bin/powershell";
        if (fs.existsSync("/usr/bin/pwsh")) {
            powerShellExePath = "/usr/bin/pwsh";
        }
    }
    return powerShellExePath;
}
exports.getDefaultPowerShellPath = getDefaultPowerShellPath;
function getWindowsSystemPowerShellPath(systemFolderName) {
    return `${process.env.windir}\\${systemFolderName}\\WindowsPowerShell\\v1.0\\powershell.exe`;
}
exports.getWindowsSystemPowerShellPath = getWindowsSystemPowerShellPath;
exports.System32PowerShellPath = getWindowsSystemPowerShellPath("System32");
exports.SysnativePowerShellPath = getWindowsSystemPowerShellPath("Sysnative");
exports.SysWow64PowerShellPath = getWindowsSystemPowerShellPath("SysWow64");
exports.WindowsPowerShell64BitLabel = "Windows PowerShell (x64)";
exports.WindowsPowerShell32BitLabel = "Windows PowerShell (x86)";
const powerShell64BitPathOn32Bit = exports.SysnativePowerShellPath.toLocaleLowerCase();
const powerShell32BitPathOn64Bit = exports.SysWow64PowerShellPath.toLocaleLowerCase();
function fixWindowsPowerShellPath(powerShellExePath, platformDetails) {
    const lowerCasedPath = powerShellExePath.toLocaleLowerCase();
    if ((platformDetails.isProcess64Bit && (lowerCasedPath === powerShell64BitPathOn32Bit)) ||
        (!platformDetails.isProcess64Bit && (lowerCasedPath === powerShell32BitPathOn64Bit))) {
        return exports.System32PowerShellPath;
    }
    // If the path doesn't need to be fixed, return the original
    return powerShellExePath;
}
exports.fixWindowsPowerShellPath = fixWindowsPowerShellPath;
function getAvailablePowerShellExes(platformDetails, sessionSettings) {
    let paths = [];
    if (platformDetails.operatingSystem === OperatingSystem.Windows) {
        if (platformDetails.isProcess64Bit) {
            paths.push({
                versionName: exports.WindowsPowerShell64BitLabel,
                exePath: exports.System32PowerShellPath,
            });
            paths.push({
                versionName: exports.WindowsPowerShell32BitLabel,
                exePath: exports.SysWow64PowerShellPath,
            });
        }
        else {
            if (platformDetails.isOS64Bit) {
                paths.push({
                    versionName: exports.WindowsPowerShell64BitLabel,
                    exePath: exports.SysnativePowerShellPath,
                });
            }
            paths.push({
                versionName: exports.WindowsPowerShell32BitLabel,
                exePath: exports.System32PowerShellPath,
            });
        }
        const psCoreInstallPath = (!platformDetails.isProcess64Bit ? process.env.ProgramW6432 : process.env.ProgramFiles) + "\\PowerShell";
        if (fs.existsSync(psCoreInstallPath)) {
            const arch = platformDetails.isProcess64Bit ? "(x64)" : "(x86)";
            const psCorePaths = fs.readdirSync(psCoreInstallPath)
                .map((item) => path.join(psCoreInstallPath, item))
                .filter((item) => {
                const exePath = path.join(item, "pwsh.exe");
                return fs.lstatSync(item).isDirectory() && fs.existsSync(exePath);
            })
                .map((item) => ({
                versionName: `PowerShell Core ${path.parse(item).base} ${arch}`,
                exePath: path.join(item, "pwsh.exe"),
            }));
            if (psCorePaths) {
                paths = paths.concat(psCorePaths);
            }
        }
    }
    else {
        // Handle Linux and macOS case
        paths.push({
            versionName: "PowerShell Core",
            exePath: this.getDefaultPowerShellPath(platformDetails),
        });
    }
    // When unit testing, we don't have session settings to test so skip reading this setting
    if (sessionSettings) {
        // Add additional PowerShell paths as configured in settings
        for (const additionalPowerShellExePath of sessionSettings.powerShellAdditionalExePaths) {
            paths.push({
                versionName: additionalPowerShellExePath.versionName,
                exePath: additionalPowerShellExePath.exePath,
            });
        }
    }
    return paths;
}
exports.getAvailablePowerShellExes = getAvailablePowerShellExes;
//# sourceMappingURL=platform.js.map