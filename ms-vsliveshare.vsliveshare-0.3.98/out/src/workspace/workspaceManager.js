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
const fs = require("fs");
const util_1 = require("../util");
/**
 * This class is serialized to JSON and written
 * to the workspace file.
 * {"folders": [{"uri": "vsls:/"}], "settings": {} }
 */
class WorkspaceDefinition {
    constructor() {
        this.folders = [];
        this.settings = {};
    }
}
exports.WorkspaceDefinition = WorkspaceDefinition;
class WorkspaceManager {
    /**
     * Creates a new workspace file in a temporary folder.
     *
     * @param workspaceFilePath Path to the workspace file.
     * @param workspaceDefinition the workspace definition (contents of the workspace file)
     */
    static createWorkspace(workspaceFilePath, workspaceDefinition) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                const workspaceFileContent = JSON.stringify(workspaceDefinition);
                if (fs.existsSync(workspaceFilePath)) {
                    return resolve(workspaceFilePath);
                }
                try {
                    util_1.ExtensionUtil.writeFile(workspaceFilePath, workspaceFileContent)
                        .then(() => { resolve(workspaceFilePath); });
                }
                catch (e) {
                    reject(e);
                }
            });
        });
    }
    static updateWorkspaceFile(workspaceDefinition, workspacePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const workspaceFileContent = JSON.stringify(workspaceDefinition);
            return util_1.ExtensionUtil.writeFile(workspacePath, workspaceFileContent);
        });
    }
}
exports.WorkspaceManager = WorkspaceManager;

//# sourceMappingURL=workspaceManager.js.map
