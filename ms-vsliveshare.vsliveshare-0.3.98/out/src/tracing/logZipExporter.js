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
const path = require("path");
const fse = require("fs-extra");
const zip = require('yazl');
class LogZipExporter {
    static createLogZipFileAsync(zipFilePath, directoryPath) {
        return __awaiter(this, void 0, void 0, function* () {
            const logFiles = (yield fse.readdir(directoryPath))
                .filter(file => file.endsWith('.log'))
                .sort();
            const zipFile = new zip.ZipFile();
            zipFile.outputStream.pipe(fse.createWriteStream(zipFilePath));
            logFiles.forEach((logFile) => {
                zipFile.addFile(path.join(directoryPath, logFile), logFile);
            });
            zipFile.end();
        });
    }
}
exports.LogZipExporter = LogZipExporter;

//# sourceMappingURL=logZipExporter.js.map
