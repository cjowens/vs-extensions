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
const fs = require("fs-extra");
const path = require("path");
const tmp = require("tmp");
const util_1 = require("./util");
const util = require("./util");
const traceSource_1 = require("./tracing/traceSource");
const unzip = require("better-unzip");
const tar = require("tar");
const download = require("download");
const crypto = require("crypto");
const glob = require("glob");
class PackageError extends Error {
    // Do not put PII (personally identifiable information) in the 'message' field as it will be logged to telemetry
    constructor(message, pkg = null, innerError = null) {
        super(message);
        this.message = message;
        this.pkg = pkg;
        this.innerError = innerError;
    }
}
exports.PackageError = PackageError;
class PackageManager {
    constructor(platform, architecture, packageJSON) {
        this.platform = platform;
        this.architecture = architecture;
        this.packageJSON = packageJSON;
        this.packageStats = {};
        this.tempPath = 'temp';
        if (this.packageJSON.runtimeDependencies) {
            this.allPackages = this.packageJSON.runtimeDependencies;
        }
        else {
            throw (new PackageError('Package manifest does not exist.'));
        }
        // Ensure our temp files get cleaned up in case of error.
        tmp.setGracefulCleanup();
    }
    get stats() {
        return this.packageStats;
    }
    getPackages() {
        let list = this.allPackages;
        return list.filter(pkg => {
            if (pkg.architectures && pkg.architectures.indexOf(this.architecture) === -1) {
                return false;
            }
            if (pkg.platforms && pkg.platforms.indexOf(this.platform) === -1) {
                return false;
            }
            return true;
        });
    }
    downloadPackagesAsync(status) {
        return __awaiter(this, void 0, void 0, function* () {
            const packages = this.getPackages();
            for (const pkg of packages) {
                this.stats[pkg.code] = {};
                yield this.maybeDownloadPackageAsync(pkg, status);
            }
        });
    }
    installPackagesAsync(status) {
        return __awaiter(this, void 0, void 0, function* () {
            const packages = this.getPackages();
            for (const pkg of packages) {
                yield this.installPackageAsync(pkg, status);
            }
        });
    }
    getBaseInstallPath(pkg) {
        let basePath = util_1.ExtensionUtil.Context.extensionPath;
        if (pkg.installPath) {
            basePath = path.join(basePath, pkg.installPath);
        }
        return basePath;
    }
    getBaseUnpackPath(basePath, pkg) {
        if (pkg.unpackPath) {
            basePath = path.join(basePath, pkg.unpackPath);
        }
        return basePath;
    }
    getBaseRetryDeletePath(basePath, baseUnpackPath, pkg) {
        if (pkg.retryDeletePath) {
            return path.join(basePath, pkg.retryDeletePath);
        }
        if (basePath !== baseUnpackPath) {
            return baseUnpackPath;
        }
    }
    maybeDownloadPackageAsync(pkg, status) {
        return __awaiter(this, void 0, void 0, function* () {
            let shouldDownload = !(yield this.doesPackageTestPathExistAsync(pkg));
            if (shouldDownload) {
                yield this.downloadPackageAsync(pkg, status);
            }
            else {
                traceSource_1.traceSource.info(`Skipping package '${pkg.description}' (already downloaded).`);
            }
            this.stats[pkg.code].didDownload = shouldDownload;
        });
    }
    downloadPackageAsync(pkg, status) {
        return __awaiter(this, void 0, void 0, function* () {
            traceSource_1.traceSource.info(`Downloading package '${pkg.description}' `);
            status.setMessage('Finishing VS Live Share installation (downloading)...');
            pkg.tmpFile = yield this.createTempFile(pkg);
            yield this.downloadFileAsync(pkg.url, pkg);
            traceSource_1.traceSource.info('Download complete.');
        });
    }
    downloadFileAsync(urlString, pkg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!pkg.tmpFile || pkg.tmpFile.fd === 0) {
                throw new PackageError('Temporary package file unavailable', pkg);
            }
            try {
                let data = yield download(urlString, null, { followRedirect: true });
                let hash = crypto.createHash('sha256').update(data).digest('hex');
                let hasMatch = hash === pkg.checksum;
                this.stats[pkg.code].checksumPass = hasMatch;
                if (!hasMatch) {
                    throw new PackageError('Checksum does not match for ' + pkg.description, pkg);
                }
                fs.writeFileSync(pkg.tmpFile.name, data);
            }
            catch (err) {
                throw new PackageError(`Reponse error: ${err.message || 'NONE'}`, pkg, err);
            }
        });
    }
    createTempFile(pkg) {
        return new Promise((resolve, reject) => {
            tmp.file({ prefix: 'package-' }, (err, tmpPath, fd, cleanupCallback) => {
                if (err) {
                    return reject(new PackageError('Error from tmp.file', pkg, err));
                }
                resolve({ name: tmpPath, fd: fd, removeCallback: cleanupCallback });
            });
        });
    }
    doesPackageTestPathExistAsync(pkg) {
        const testPath = this.getPackageTestPath(pkg);
        if (testPath) {
            return util.fileExistsAsync(testPath);
        }
        else {
            return Promise.resolve(false);
        }
    }
    getPackageTestPath(pkg) {
        if (pkg.installTestPath) {
            return path.join(util_1.ExtensionUtil.Context.extensionPath, pkg.installTestPath);
        }
        else {
            return null;
        }
    }
    installPackageAsync(pkg, status) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!pkg.tmpFile) {
                // Download of this package was skipped, so there is nothing to install
                return;
            }
            traceSource_1.traceSource.info(`Installing package '${pkg.description}'`);
            status.setMessage('Finishing VS Live Share installation (installing)...');
            try {
                if (pkg.tmpFile.fd === 0) {
                    throw new PackageError('Downloaded file unavailable', pkg);
                }
                const baseInstallPath = this.getBaseInstallPath(pkg);
                const baseUnpackPath = this.getBaseUnpackPath(baseInstallPath, pkg);
                const baseRetryDeletePath = this.getBaseRetryDeletePath(baseInstallPath, baseUnpackPath, pkg);
                yield this.ensureCleanUnpackPath(baseRetryDeletePath);
                const baseFilesPreUnpack = this.getAllFilesSync(baseUnpackPath);
                this.stats[pkg.code].totalBaseFilesPreUnpack = baseFilesPreUnpack.length;
                yield this.unpackDownloadedPackage(pkg, baseUnpackPath);
                const baseFilesPostUnpack = this.getAllFilesSync(baseUnpackPath);
                const filesAdded = baseFilesPostUnpack.length - baseFilesPreUnpack.length;
                this.stats[pkg.code].totalBaseFilesPostUnpack = baseFilesPostUnpack.length;
                this.stats[pkg.code].totalFilesExtracted = filesAdded;
                this.validateExtractedFiles(pkg, baseFilesPostUnpack.length);
                if (pkg.packageRootPath) {
                    const baseFilesPreMove = this.getAllFilesSync(baseInstallPath);
                    this.stats[pkg.code].totalBaseFilesPreMove = baseFilesPreMove.length;
                    this.moveUnpackedFiles(baseInstallPath, baseUnpackPath);
                    const baseFilesPostMove = this.getAllFilesSync(baseInstallPath);
                    this.stats[pkg.code].totalBaseFilesPostMove = baseFilesPostMove.length;
                    this.stats[pkg.code].totalFileMovedOffset = baseFilesPreMove.length - baseFilesPostMove.length;
                }
                traceSource_1.traceSource.info('Finished installing.');
            }
            catch (err) {
                // If anything goes wrong with unzip, make sure we delete the test path (if there is one)
                // so we will retry again later
                const testPath = this.getPackageTestPath(pkg);
                if (testPath) {
                    fs.unlink(testPath, err => { });
                }
                throw err;
            }
            finally {
                // Clean up temp file
                pkg.tmpFile.removeCallback();
            }
        });
    }
    ensureCleanUnpackPath(baseRetryDeletePath) {
        return __awaiter(this, void 0, void 0, function* () {
            if (baseRetryDeletePath && (yield fs.pathExists(baseRetryDeletePath))) {
                yield fs.remove(baseRetryDeletePath);
                traceSource_1.traceSource.info('Cleaned old files from install path.');
            }
        });
    }
    unpackDownloadedPackage(pkg, baseUnpackPath) {
        return __awaiter(this, void 0, void 0, function* () {
            if (pkg.url.endsWith('zip')) {
                yield this.unzipPackageAsync(pkg, baseUnpackPath);
            }
            else if (pkg.url.endsWith('tar.gz')) {
                yield this.untarPackageAsync(pkg, baseUnpackPath);
            }
            traceSource_1.traceSource.verbose('Extracted packed files');
        });
    }
    unzipPackageAsync(pkg, baseUnpackPath) {
        return new Promise((resolve, reject) => {
            fs.createReadStream(pkg.tmpFile.name)
                .pipe(unzip.Extract({ path: baseUnpackPath }))
                .on('close', () => {
                resolve();
            })
                .on('error', (zipErr) => {
                reject(new PackageError('Zip File Error:' + zipErr.code || '', pkg, zipErr));
            });
        });
    }
    untarPackageAsync(pkg, baseUnpackPath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield fs.ensureDir(baseUnpackPath);
                yield tar.extract({ cwd: baseUnpackPath, file: pkg.tmpFile.name }, [pkg.packageRootPath]);
            }
            catch (err) {
                throw new PackageError('Zip File Error:' + err.code || '', pkg, err);
            }
        });
    }
    validateExtractedFiles(pkg, filesAdded) {
        if (pkg.fileTotal !== filesAdded) {
            throw new PackageError(`Incorrect number of files where unpacked from archive (${pkg.code}). Expected: ${pkg.fileTotal}, unpacked: ${filesAdded}`, pkg);
        }
        traceSource_1.traceSource.info('Validated extracted files.');
    }
    moveUnpackedFiles(baseInstallPath, baseUnpackPath) {
        let files = this.getAllFilesSync(baseUnpackPath);
        files.forEach((f) => {
            let targetPath = path.join(baseInstallPath, path.basename(f));
            util.moveElseThrowSync(f, targetPath);
        });
        traceSource_1.traceSource.info(`Moved and validated extracted files.`);
    }
    getAllFilesSync(cwd) {
        return glob.sync('**/*', { cwd, nodir: true, absolute: true });
    }
}
exports.PackageManager = PackageManager;

//# sourceMappingURL=packageManager.js.map
