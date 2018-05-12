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
const os = require("os");
const path = require("path");
const url = require("url");
const fse = require("fs-extra");
const uuid4 = require("uuid/v4");
const child_process = require("child_process");
const traceSource_1 = require("./tracing/traceSource");
const service_1 = require("./workspace/service");
const joinDebugManager_1 = require("./debugger/joinDebugManager");
const breakpointManager_1 = require("./debugger/breakpointManager");
const lspServer = require("./languageService/lspServer");
const at = require("./workspace/contract/AuthenticationServiceTypes");
const wt = require("./workspace/contract/WorkspaceServiceTypes");
const ContractConstants_1 = require("./workspace/contract/ContractConstants");
const launcher_1 = require("./launcher");
const util = require("./util");
const config = require("./config");
const config_1 = require("./config");
const util_1 = require("./util");
const workspaceManager_1 = require("./workspace/workspaceManager");
const session_1 = require("./session");
const clipboardy_1 = require("clipboardy");
const telemetry_1 = require("./telemetry/telemetry");
const portForwardingTelemetry_1 = require("./telemetry/portForwardingTelemetry");
const logZipExporter_1 = require("./tracing/logZipExporter");
const logFileTraceListener_1 = require("./tracing/logFileTraceListener");
const FirewallServiceTypes_1 = require("./workspace/contract/FirewallServiceTypes");
const agent_1 = require("./agent");
const WorkspaceTaskClient = require("./tasks/workspaceTaskClient");
const WorkspaceTaskService = require("./tasks/workspaceTaskService");
const coauthoringService_1 = require("./coediting/common/coauthoringService");
const semaphore_async_await_1 = require("semaphore-async-await");
const languageServiceTelemetry_1 = require("./telemetry/languageServiceTelemetry");
var SignInPromptUserAction;
(function (SignInPromptUserAction) {
    SignInPromptUserAction[SignInPromptUserAction["Proceed"] = 0] = "Proceed";
    SignInPromptUserAction[SignInPromptUserAction["Cancel"] = 1] = "Cancel";
})(SignInPromptUserAction || (SignInPromptUserAction = {}));
class Commands {
    constructor(rpcClient, authService, telemetryService, workspaceService, fileService, statusBarController, hostAdapterService, serverSharingService, portForwardingService, sourceEventService, workspaceUserService, firewallService, debugManager, shareDebugManager, terminalService) {
        this.rpcClient = rpcClient;
        this.authService = authService;
        this.telemetryService = telemetryService;
        this.workspaceService = workspaceService;
        this.fileService = fileService;
        this.statusBarController = statusBarController;
        this.hostAdapterService = hostAdapterService;
        this.serverSharingService = serverSharingService;
        this.portForwardingService = portForwardingService;
        this.sourceEventService = sourceEventService;
        this.workspaceUserService = workspaceUserService;
        this.firewallService = firewallService;
        this.debugManager = debugManager;
        this.shareDebugManager = shareDebugManager;
        this.terminalService = terminalService;
        this.extensionInstanceId = Commands.generateExtensionId();
        this.integratedTerminals = new Map();
        this.acceptSemaphore = new semaphore_async_await_1.default(1);
        this.checkForSharedServers = (event) => __awaiter(this, void 0, void 0, function* () {
            try {
                let sharedServers;
                if (session_1.SessionContext.State === session_1.SessionState.Joined) {
                    sharedServers = yield this.portForwardingService.getSharedServersAsync();
                }
                else if (session_1.SessionContext.State === session_1.SessionState.Shared) {
                    sharedServers = yield this.serverSharingService.getSharedServersAsync();
                }
                session_1.SessionContext.ServersShared = sharedServers.length > 0;
            }
            catch (e) {
                traceSource_1.traceSource.error('Checking for shared servers failed: ' + e);
            }
        });
        this.onTerminalStarted = (event) => __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State === session_1.SessionState.Joined || session_1.SessionContext.State === session_1.SessionState.Shared) {
                session_1.SessionContext.HasSharedTerminals = true;
                if (session_1.SessionContext.State === session_1.SessionState.Joined) {
                    this.createTerminal(event.terminal);
                }
            }
            else {
                session_1.SessionContext.HasSharedTerminals = false;
            }
        });
        this.onTerminalStopped = (event) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (session_1.SessionContext.State === session_1.SessionState.Joined || session_1.SessionContext.State === session_1.SessionState.Shared) {
                    const terminals = yield this.getRunningTerminalsAsync();
                    session_1.SessionContext.HasSharedTerminals = terminals.length > 0;
                }
                else {
                    session_1.SessionContext.HasSharedTerminals = false;
                }
            }
            catch (e) {
                traceSource_1.traceSource.error('Checking for shared terminals failed: ' + e);
            }
        });
        this.register();
        this.workspaceService.onConnectionStatusChanged((e) => this.onWorkspaceConnectionStatusChanged(e));
        this.workspaceService.onProgressUpdated((e) => this.onWorkspaceProgressUpdated(e));
        this.workspaceUserService.onSessionChanged((e) => this.onWorkspaceSessionChanged(e));
        this.portForwardingService.onSharingStarted(this.checkForSharedServers);
        this.portForwardingService.onSharingStopped(this.checkForSharedServers);
        this.serverSharingService.onSharingStarted(this.checkForSharedServers);
        this.serverSharingService.onSharingStopped(this.checkForSharedServers);
        this.terminalService.onTerminalStarted(this.onTerminalStarted);
        this.terminalService.onTerminalStopped(this.onTerminalStopped);
        this.hostAdapterService.runInTerminal = this.hostAdapterService_RunInTerminal.bind(this);
    }
    static generateExtensionId() {
        return uuid4();
    }
    register() {
        const context = util_1.ExtensionUtil.Context;
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.signin.token', () => this.signInToken()));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.signin', (isSilent) => this.startSignInProcess(isSilent)));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.signin.browser', () => this.startSignInProcess(false, false)));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.signout', () => this.signOut()));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.start', (options) => this.startCollaboration(options)));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.end', () => this.endCollaboration()));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.join', (joinCollaborationLink, options) => this.joinCollaboration(joinCollaborationLink, options)));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.leave', () => this.leaveCollaboration()));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.debug', () => this.debug()));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.listSharedServers', this.listSharedServers, this));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.shareServer', this.shareServer, this));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.unshareServer', this.unshareServer, this));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.launcherSetup', () => launcher_1.Launcher.setup(true)));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.exportLogs', () => this.exportLogsAsync()));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.shareTerminal', this.shareTerminal, this));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.listSharedTerminals', this.listSharedTerminals, this));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.focusParticipants', this.summonParticipants, this));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand(Commands.listParticipantsCommandId, this.listParticipants, this));
        context.subscriptions.push(util_1.ExtensionUtil.registerCommand('liveshare.resetLanguageServices', () => __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.coeditingClient) {
                session_1.SessionContext.coeditingClient.resetLanguageServicesDataStructures();
                (new telemetry_1.TelemetryEvent(languageServiceTelemetry_1.LanguageServiceTelemetryEventNames.RESET_LANGUAGE_SERVICES)).send();
            }
        }), this));
        if (config.get(config.Key.diagnosticLogging)) {
            util_1.ExtensionUtil.setCommandContext(Commands.logsEnabled, true);
        }
        else {
            util_1.ExtensionUtil.setCommandContext(Commands.logsEnabled, false);
        }
    }
    // Return when a command is enabled
    isCommandEnabled(commandId) {
        if (commandId === 'liveshare.debug') {
            return this.joinDebugManager.getAvailableDebugSessions().length > 0;
        }
        return false;
    }
    startCollaboration(options) {
        return __awaiter(this, void 0, void 0, function* () {
            let showInvitationLink = yield util_1.ExtensionUtil
                .runWithProgress(() => this.startCollaborationHelper(), 'Sharing...');
            if (showInvitationLink && !(options && options.suppressNotification)) {
                this.showInvitationLink();
            }
            const sessionInfo = session_1.SessionContext.workspaceSessionInfo;
            if (sessionInfo) {
                vscode.workspace.saveAll(false);
                return vscode.Uri.parse(sessionInfo.joinUri);
            }
            else {
                traceSource_1.traceSource.info('Share was not successful due to null "SessionContext.workspaceSessionInfo".');
            }
            return null;
        });
    }
    //Returns whether or not invitation link should be shown
    startCollaborationHelper() {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State === session_1.SessionState.Shared) {
                return true;
            }
            else if (session_1.SessionContext.State === session_1.SessionState.Joined) {
                throw new Error('Already joined a collaboration session.');
            }
            else if (!vscode.workspace.rootPath) {
                throw new Error('Please open a folder or workspace to share.');
            }
            let shareTelemetryEvent = telemetry_1.Instance.startTimedEvent(telemetry_1.TelemetryEventNames.SHARE_WORKSPACE);
            telemetry_1.Instance.setCorrelationEvent(shareTelemetryEvent);
            const userInfo = yield this.signIn();
            if (!userInfo) {
                shareTelemetryEvent.end(telemetry_1.TelemetryResult.IndeterminateFailure, 'Share canceled - sign-in failed or was cancelled.');
                return false;
            }
            shareTelemetryEvent.markTime(telemetry_1.TelemetryPropertyNames.SIGN_IN_COMPLETE);
            let telemetryMessage;
            switch (userInfo.accountStatus) {
                case at.UserAccountStatus.Pending:
                    telemetryMessage = 'Share failed - account status \'Pending\'.';
                    shareTelemetryEvent.end(telemetry_1.TelemetryResult.UserFailure, telemetryMessage);
                    telemetry_1.Instance.sendShareFault(telemetry_1.FaultType.User, telemetryMessage, null, shareTelemetryEvent);
                    yield util_1.ExtensionUtil.showErrorAsync(`You cannot share as you have signed up for the VS Live Share preview but have not yet been accepted.`);
                    break;
                case at.UserAccountStatus.Transient:
                    telemetryMessage = 'Share failed - account status \'Transient\'.';
                    shareTelemetryEvent.end(telemetry_1.TelemetryResult.UserFailure, telemetryMessage);
                    telemetry_1.Instance.sendShareFault(telemetry_1.FaultType.User, telemetryMessage, null, shareTelemetryEvent);
                    const result = yield vscode.window.showWarningMessage(`You cannot share as you have not been accepted into the VS Live Share preview. If you haven't, sign up now to be considered for a future preview wave.`, { title: 'Sign Up Now' });
                    if (!result)
                        return;
                    util_1.ExtensionUtil.openBrowser(config.get(config.Key.registrationUri));
                    break;
                default:
                    let prevState = session_1.SessionContext.State;
                    session_1.SessionContext.userInfo = userInfo;
                    session_1.SessionContext.transition(session_1.SessionAction.AttemptSharing);
                    let workspaceShareInfo = {
                        rootDirectories: [vscode.workspace.rootPath],
                        name: util.PathUtil.getWorkspaceName(vscode.workspace.rootPath),
                        connectionMode: config.get(config.Key.connectionMode)
                    };
                    try {
                        if (!(yield this.performFirewallCheckAsync())) {
                            session_1.SessionContext.transition(session_1.SessionAction.SharingError);
                            telemetryMessage = 'Share failed. Firewall check failed.';
                            shareTelemetryEvent.end(telemetry_1.TelemetryResult.Failure, telemetryMessage);
                            telemetry_1.Instance.sendShareFault(telemetry_1.FaultType.Error, telemetryMessage, shareTelemetryEvent);
                            yield util_1.ExtensionUtil.showErrorAsync(util_1.ExtensionUtil.getString('error.BlockActionShareFailed'), { modal: false });
                            return false;
                        }
                        session_1.SessionContext.workspaceSessionInfo = yield this.workspaceService.shareWorkspaceAsync(workspaceShareInfo);
                        // SessionContext.workspaceSessionInfo may be null.
                        // TODO: enable strictNullChecks in tsconfig
                        if (!session_1.SessionContext.workspaceSessionInfo) {
                            throw new Error('Failed to create a collaboration session. An error occurred while sending the request.');
                        }
                        shareTelemetryEvent.markTime(telemetry_1.TelemetryPropertyNames.SHARE_WORKSPACE_COMPLETE);
                        session_1.SessionContext.initCoEditingContext({
                            sourceEventService: this.sourceEventService,
                            userInfo: userInfo,
                            statusBarController: this.statusBarController,
                            fileSystemService: this.fileService,
                            isExpert: false
                        });
                        yield this.setupCollaboratorCommands();
                    }
                    catch (e) {
                        session_1.SessionContext.transition(session_1.SessionAction.SharingError);
                        const unknownError = !session_1.SessionContext.workspaceSessionInfo;
                        telemetryMessage = 'Share failed. ' + e.message;
                        shareTelemetryEvent.end(unknownError ? telemetry_1.TelemetryResult.IndeterminateFailure : telemetry_1.TelemetryResult.Failure, telemetryMessage);
                        telemetry_1.Instance.sendShareFault(unknownError ? telemetry_1.FaultType.Unknown : telemetry_1.FaultType.Error, telemetryMessage, e, shareTelemetryEvent);
                        yield util_1.ExtensionUtil.showErrorAsync(e);
                        return false;
                    }
                    session_1.SessionContext.transition(session_1.SessionAction.SharingSuccess);
                    // Share debug manager
                    yield this.shareDebugManager.setShareState(true);
                    yield lspServer.activateAsync(this.workspaceService);
                    // Create breakpoint manager instance
                    yield this.createBreakpointManager(true);
                    yield WorkspaceTaskService.enable(this.rpcClient, this.workspaceService);
                    shareTelemetryEvent.markTime(telemetry_1.TelemetryPropertyNames.INIT_DEBUGGING_COMPLETE);
                    shareTelemetryEvent.end(telemetry_1.TelemetryResult.Success, 'Share success.');
                    return true;
            }
        });
    }
    /// <summary>
    /// Performs firewall rules check for the vsls-agent.exe process.
    /// </summary>
    /// <param name="session">Current client session.</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>True if sharing operation should continue, false otherwise.</returns>
    performFirewallCheckAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            let connectionMode = config.get(config.Key.connectionMode);
            if (wt.ConnectionMode.Auto === connectionMode ||
                wt.ConnectionMode.Direct === connectionMode) {
                let firewallStatus = yield this.firewallService.getFirewallStatusAsync();
                if (FirewallServiceTypes_1.FirewallStatus.Block === firewallStatus) {
                    let message;
                    switch (connectionMode) {
                        case wt.ConnectionMode.Direct:
                            yield this.showFirewallInformationMessage('error.BlockActionDirectModePrompt', false);
                            return false;
                        case wt.ConnectionMode.Auto:
                            if (yield this.showFirewallInformationMessage('warning.BlockActionAutoModePrompt', true)) {
                                yield config.save(config.Key.connectionMode, wt.ConnectionMode.Relay, true, true);
                                return true;
                            }
                            return false;
                        default:
                            break;
                    }
                }
                else if (FirewallServiceTypes_1.FirewallStatus.None === firewallStatus) {
                    let message;
                    switch (connectionMode) {
                        case wt.ConnectionMode.Direct:
                            yield this.showFirewallInformationMessage('info.NoneActionDirectModePrompt', false);
                            break;
                        case wt.ConnectionMode.Auto:
                            yield this.showFirewallInformationMessage('info.NoneActionAutoModePrompt', false);
                            break;
                        default:
                            break;
                    }
                }
            }
            return true;
        });
    }
    showFirewallInformationMessage(messageId, showCancelOption) {
        return __awaiter(this, void 0, void 0, function* () {
            const getHelp = 'Help';
            const ok = 'OK';
            let result;
            if (showCancelOption) {
                result = yield vscode.window.showInformationMessage(util_1.ExtensionUtil.getString(messageId), { modal: true }, getHelp, ok);
            }
            else {
                let getHelpObject = { title: getHelp, isCloseAffordance: false };
                result = yield vscode.window.showInformationMessage(util_1.ExtensionUtil.getString(messageId), { modal: true }, getHelpObject, { title: ok, isCloseAffordance: true });
                if (result === getHelpObject) {
                    result = getHelp;
                }
                else {
                    result = ok;
                }
            }
            if (result === getHelp) {
                this.showFirewallHelp();
                return yield this.showFirewallInformationMessage(messageId, showCancelOption);
            }
            else {
                return result === ok;
            }
        });
    }
    showFirewallHelp() {
        const firewallHelpLink = 'https://go.microsoft.com/fwlink/?linkid=869620';
        util_1.ExtensionUtil.openBrowser(firewallHelpLink);
    }
    showSecurityInfo() {
        const securityInfoLink = 'https://aka.ms/vsls-security';
        util_1.ExtensionUtil.openBrowser(securityInfoLink);
    }
    createBreakpointManager(isSharing) {
        return __awaiter(this, void 0, void 0, function* () {
            if (breakpointManager_1.BreakpointManager.hasVSCodeSupport()) {
                this.breakpointManager = new breakpointManager_1.BreakpointManager(isSharing, this.sourceEventService);
                yield this.breakpointManager.initialize();
            }
        });
    }
    showInvitationLink(link) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!link || link === session_1.SessionContext.workspaceSessionInfo.joinUri) {
                const currentLink = session_1.SessionContext.workspaceSessionInfo.joinUri;
                yield clipboardy_1.write(currentLink);
                const result = yield vscode.window.showInformationMessage('Invite link copied to clipboard! Send it to anyone you trust or ' +
                    'click "Security info" to understand more about secure sharing.', { id: 1, title: 'Security info' }, { id: 2, title: 'Copy again' });
                if (result && result.id === 1) {
                    this.showSecurityInfo();
                    // Prevent this button from dismissing the notification.
                    yield this.showInvitationLink(currentLink);
                }
                else if (result && result.id === 2) {
                    yield this.showInvitationLink(currentLink);
                }
            }
            else {
                yield vscode.window.showErrorMessage('This invite link has expired. Share again to generate a new link.');
            }
        });
    }
    endCollaboration() {
        return util_1.ExtensionUtil.runWithProgress(() => this.endCollaborationHelper(), 'Ending Collaboration Session...');
    }
    endCollaborationHelper() {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State !== session_1.SessionState.Shared) {
                throw new Error('Not currently hosting a collaboration session.');
            }
            // Unshare debug Manager
            yield this.shareDebugManager.setShareState(false);
            if (this.breakpointManager) {
                yield this.breakpointManager.dispose();
            }
            yield lspServer.dispose();
            yield WorkspaceTaskService.disable();
            yield this.workspaceService.unshareWorkspaceAsync(session_1.SessionContext.workspaceSessionInfo.id);
            session_1.SessionContext.transition(session_1.SessionAction.EndSharing);
            // Not awaited since this should not block collaboration ending
            this.getFeedback();
        });
    }
    getFeedback() {
        return __awaiter(this, void 0, void 0, function* () {
            const sessionCount = config.get(config.Key.sessionCount) + 1;
            config.save(config.Key.sessionCount, sessionCount);
            const goodResponse = '🙂';
            const badResponse = '☹️';
            const apatheticResponse = 'Don\'t Ask Again';
            const dismissedResponse = 'Dismissed';
            // Request feedback
            if (config.get(config.Key.requestFeedback) && sessionCount % 5 === 0) {
                let qualitativeFeedback = yield vscode.window.showInformationMessage('How was your collaboration session?', goodResponse, badResponse, apatheticResponse);
                if (!qualitativeFeedback) {
                    qualitativeFeedback = dismissedResponse;
                }
                switch (qualitativeFeedback) {
                    case goodResponse:
                    case badResponse:
                    case apatheticResponse:
                        config.save(config.Key.requestFeedback, false);
                        break;
                    default:
                        break;
                }
                telemetry_1.TelemetryEvent.create(telemetry_1.TelemetryEventNames.FEEDBACK, {
                    properties: {
                        qualitativeFeedback
                    }
                }).send();
            }
        });
    }
    getValidWorkspaceFromLink(joinCollaborationLink) {
        return __awaiter(this, void 0, void 0, function* () {
            const linkMatch = Commands.joinLinkRegex.exec(joinCollaborationLink);
            const cascadeMatch = Commands.cascadeLinkRegex.exec(joinCollaborationLink);
            if (!linkMatch && !cascadeMatch) {
                throw new Error('The specified value isn’t a valid Live Share URL. Please check the link provided by the host and try again.');
            }
            const workspaceId = (linkMatch && linkMatch[1]) || (cascadeMatch && cascadeMatch[1]);
            const workspace = yield this.workspaceService.getWorkspaceAsync(workspaceId);
            if (!workspace || !workspace.joinUri) {
                // No workspace or joinUri found - handle the error from the caller
                return undefined;
            }
            if (cascadeMatch) {
                // protocol handler links are currently not validated
                return workspace;
            }
            const { hostname: linkHostname } = url.parse(joinCollaborationLink);
            const { hostname: workspaceHostname } = url.parse(workspace.joinUri);
            if (linkHostname !== workspaceHostname) {
                throw new Error('The specified hostname isn’t a valid Live Share URL. Please check the link provided by the host and try again.');
            }
            return workspace;
        });
    }
    joinCollaboration(joinCollaborationLink, options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State === session_1.SessionState.Joined) {
                throw new Error('Already joined a collaboration session.');
            }
            else if (session_1.SessionContext.State === session_1.SessionState.Shared) {
                throw new Error('Already hosting a collaboration session.');
            }
            let withLink = joinCollaborationLink ? 'True' : 'False';
            if (!joinCollaborationLink) {
                let clipboardValue = '';
                try {
                    clipboardValue = clipboardy_1.readSync().trim();
                }
                catch (e) {
                    // do not pull value from clipboard
                }
                joinCollaborationLink = yield vscode.window.showInputBox({
                    prompt: 'Enter a link to the workspace to join',
                    ignoreFocusOut: true,
                    value: Commands.joinLinkRegex.test(clipboardValue) ? clipboardValue : ''
                });
                if (!joinCollaborationLink) {
                    // The user cancelled out of the input dialog.
                    return;
                }
            }
            joinCollaborationLink = joinCollaborationLink.trim();
            let joinEvent = telemetry_1.Instance.startTimedEvent(telemetry_1.TelemetryEventNames.JOIN_WORKSPACE);
            joinEvent.addProperty(telemetry_1.TelemetryPropertyNames.JOIN_WITH_LINK, withLink);
            telemetry_1.Instance.setCorrelationEvent(joinEvent);
            const userInfo = yield this.signIn({ isJoining: true });
            if (!userInfo) {
                joinEvent.end(telemetry_1.TelemetryResult.Cancel, 'Join canceled - sign-in failed or was cancelled.');
                // Sign-in failed or was cancelled.
                return;
            }
            joinEvent.markTime(telemetry_1.TelemetryPropertyNames.SIGN_IN_COMPLETE);
            session_1.SessionContext.userInfo = userInfo;
            session_1.SessionContext.transition(session_1.SessionAction.AttemptJoining);
            try {
                let joined = yield util_1.ExtensionUtil.runWithProgress(() => this.joinCollaborationHelper(joinCollaborationLink, options, joinEvent), 'Joining...');
                if (!joined) {
                    session_1.SessionContext.transition(session_1.SessionAction.JoiningError);
                    const telemetryMessage = 'Join user failed - workspace not found.';
                    joinEvent.end(telemetry_1.TelemetryResult.IndeterminateFailure, telemetryMessage);
                    telemetry_1.Instance.sendJoinFault(telemetry_1.FaultType.Unknown, telemetryMessage, null, joinEvent);
                    yield util_1.ExtensionUtil.showErrorAsync('Collaboration session not found.');
                }
                else {
                    // When joining, we don't actually do the joinining in this context. We
                    // wait for the reload (which we have no insight into). This isn't terribly
                    // important in the case where we successfully open the folder (Which is
                    // most of the time). _However_, if the customer has dirty state in whatever
                    // project they already have open, and clicks cancel, we get no notification
                    // of that (See https://github.com/Microsoft/vscode-cascade/issues/37).
                    // Thus, when they click cancel, if we do nothing we leave the session in a bad
                    // state, and they can't attempt to rejoin again. This state transition
                    // puts us back into a "signed in" state so they can attempt to rejoin after
                    // addressing their dirty state.
                    session_1.SessionContext.transition(session_1.SessionAction.JoiningPendingReload);
                }
            }
            catch (e) {
                session_1.SessionContext.transition(session_1.SessionAction.JoiningError);
                const telemetryMessage = 'Join failed. ' + e.message;
                joinEvent.end(telemetry_1.TelemetryResult.Failure, telemetryMessage);
                telemetry_1.Instance.sendJoinFault(telemetry_1.FaultType.Error, telemetryMessage, e, joinEvent);
                yield util_1.ExtensionUtil.showErrorAsync('Join failed. ' + e.message);
            }
        });
    }
    joinCollaborationHelper(joinCollaborationLink, options, joinEvent) {
        return __awaiter(this, void 0, void 0, function* () {
            const isNewWindow = config.get(config.Key.joinInNewWindow);
            const workspaceInfo = yield this.getValidWorkspaceFromLink(joinCollaborationLink);
            if (!workspaceInfo) {
                return false;
            }
            joinEvent.markTime(telemetry_1.TelemetryPropertyNames.GET_WORKSPACE_COMPLETE);
            let workspaceFolder = path.join(os.tmpdir(), `tmp-${workspaceInfo.id}`);
            if (isNewWindow) {
                workspaceFolder += `_${Date.now()}`;
            }
            try {
                yield fse.ensureDir(workspaceFolder);
            }
            catch (e) {
                const telemetryMessage = 'Join failed on workspace folder creation ' + e.code;
                telemetry_1.Instance.sendJoinFault(telemetry_1.FaultType.Error, telemetryMessage, e);
                throw e;
            }
            const workspaceFilePath = path.join(workspaceFolder, `${config.get(config.Key.name)}.code-workspace`);
            const workspaceDefinition = new workspaceManager_1.WorkspaceDefinition();
            const cascadeFolder = { 'uri': Commands.cascadeLauncherScheme + '/', name: (workspaceInfo.name || 'Loading file tree...') };
            workspaceDefinition.folders.push(cascadeFolder);
            // settings
            workspaceDefinition.settings[Commands.joinWorkspaceIdSettingName] = workspaceInfo.id;
            workspaceDefinition.settings[Commands.joinWorkspaceIdFolderSettingName] = workspaceFolder;
            workspaceDefinition.settings['files.hotExit'] = 'off';
            // disable task auto-detect for built-in providers
            workspaceDefinition.settings['typescript.tsc.autoDetect'] = 'off';
            workspaceDefinition.settings['jake.autoDetect'] = 'off';
            workspaceDefinition.settings['grunt.autoDetect'] = 'off';
            workspaceDefinition.settings['gulp.autoDetect'] = 'off';
            workspaceDefinition.settings['npm.autoDetect'] = 'off';
            // This setting allows guests to set breakpoints in any file within the workspace they
            // are joining, without requiring them to install the respective language extensions.
            workspaceDefinition.settings['debug.allowBreakpointsEverywhere'] = true;
            yield workspaceManager_1.WorkspaceManager.createWorkspace(workspaceFilePath, workspaceDefinition);
            yield config.save(config.Key.joinWorkspaceLocalPath, workspaceFilePath, true, true);
            yield config.save(config.Key.joinEventCorrelationId, joinEvent.getCorrelationId(), true, true);
            yield config.save(config.Key.workspaceReloadTime, Date.now(), true);
            const workspaceUri = vscode.Uri.file(workspaceFilePath);
            joinEvent.end(telemetry_1.TelemetryResult.Success);
            // Reloads the workpace
            vscode.commands.executeCommand('vscode.openFolder', workspaceUri, !!(options && options.newWindow));
            return true;
        });
    }
    onExtensionLoadWithLiveShareWorkspace(workspaceId, progress) {
        return __awaiter(this, void 0, void 0, function* () {
            this.reloadEvent = telemetry_1.Instance.startTimedEvent(telemetry_1.TelemetryEventNames.WORKSPACE_RELOAD);
            telemetry_1.Instance.setCorrelationEvent(this.reloadEvent);
            this.reloadEvent.correlateWithId(config.get(config.Key.joinEventCorrelationId));
            this.reloadEvent.addMeasure(telemetry_1.TelemetryPropertyNames.RELOAD_START_TIME, config.get(config.Key.workspaceReloadTime));
            this.reloadEvent.addMeasure(telemetry_1.TelemetryPropertyNames.RELOAD_RESUMED_TIME, (new Date()).getTime());
            this.joinProgress = progress;
            // On extension unload, delete the temporary workspace file
            const currentWorkspacePath = config.get(config.Key.joinWorkspaceLocalPath);
            util.ExtensionUtil.disposeOnUnload([currentWorkspacePath]);
            vscode.commands.executeCommand('vscode.removeFromRecentlyOpened', currentWorkspacePath)
                .then(() => { }, () => { });
            // Clear things stashed during reload.
            yield config.save(config.Key.joinWorkspaceLocalPath, undefined, true, true);
            yield config.save(config.Key.joinEventCorrelationId, undefined, true, true);
            yield config.save(config.Key.workspaceReloadTime, undefined, true);
            const userInfo = yield this.signIn({
                isJoining: true,
                signInPromptUserActionCallback: (status) => __awaiter(this, void 0, void 0, function* () {
                    if (status === SignInPromptUserAction.Cancel) {
                        const signInAgainItem = { title: 'Launch Sign In' };
                        const result = yield util_1.ExtensionUtil.showErrorAsync('You need to sign in before joining the collaboration session.', undefined, [
                            signInAgainItem
                        ]);
                        if (result && (result.title === signInAgainItem.title)) {
                            session_1.SessionContext.transition(session_1.SessionAction.AwaitExternalSignIn);
                            this.startSignInProcess(false, false);
                        }
                        else {
                            this.reloadEvent.end(telemetry_1.TelemetryResult.Cancel, 'Sign-in was cancelled.');
                            vscode.commands.executeCommand('workbench.action.closeFolder');
                        }
                    }
                })
            });
            if (!userInfo) {
                session_1.SessionContext.transition(session_1.SessionAction.SignInError);
                this.reloadEvent.end(telemetry_1.TelemetryResult.Failure, 'Sign-in failed.');
                return;
            }
            this.reloadEvent.markTime(telemetry_1.TelemetryPropertyNames.SIGN_IN_COMPLETE);
            const prevState = session_1.SessionContext.State;
            session_1.SessionContext.userInfo = userInfo;
            session_1.SessionContext.transition(session_1.SessionAction.AttemptJoining);
            const workspaceJoinInfo = {
                id: workspaceId,
                connectionMode: config.get(config.Key.connectionMode),
            };
            try {
                session_1.SessionContext.workspaceSessionInfo = yield this.workspaceService.joinWorkspaceAsync(workspaceJoinInfo);
                this.ensureWorkspaceName(session_1.SessionContext.workspaceSessionInfo);
                this.reloadEvent.markTime(telemetry_1.TelemetryPropertyNames.JOIN_WORKSPACE_COMPLETE);
                yield session_1.SessionContext.initCoEditingContext({
                    sourceEventService: this.sourceEventService,
                    userInfo: userInfo,
                    statusBarController: this.statusBarController,
                    fileSystemService: this.fileService,
                    isExpert: true
                });
                yield this.setupCollaboratorCommands();
                this.reloadEvent.markTime(telemetry_1.TelemetryPropertyNames.INIT_COEDITING_COMPLETE);
            }
            catch (e) {
                session_1.SessionContext.transition(session_1.SessionAction.JoiningError);
                const telemetryMessage = 'Join failed post reload. ' + e.message;
                switch (e.code) {
                    case ContractConstants_1.ErrorCodes.CollaborationSessionGuestRejected: {
                        this.reloadEvent.addProperty(telemetry_1.TelemetryPropertyNames.REJECTED_BY_HOST, true);
                        this.reloadEvent.end(telemetry_1.TelemetryResult.UserFailure, telemetryMessage);
                        break;
                    }
                    case ContractConstants_1.ErrorCodes.CollaborationSessionGuestCanceled: {
                        this.reloadEvent.addProperty(telemetry_1.TelemetryPropertyNames.GUEST_CANCELED, true);
                        this.reloadEvent.end(telemetry_1.TelemetryResult.UserFailure, telemetryMessage);
                        break;
                    }
                    case ContractConstants_1.ErrorCodes.CollaborationSessionRequestTimedOut: {
                        this.reloadEvent.addProperty(telemetry_1.TelemetryPropertyNames.JOIN_REQUEST_TIMED_OUT, true);
                        this.reloadEvent.end(telemetry_1.TelemetryResult.UserFailure, telemetryMessage);
                        break;
                    }
                    case ContractConstants_1.ErrorCodes.CollaborationSessionNotFound: {
                        this.reloadEvent.addProperty(telemetry_1.TelemetryPropertyNames.WORKSPACE_NOT_FOUND, true);
                        this.reloadEvent.end(telemetry_1.TelemetryResult.UserFailure, telemetryMessage);
                        break;
                    }
                    default: {
                        this.reloadEvent.end(telemetry_1.TelemetryResult.Failure, telemetryMessage);
                        telemetry_1.Instance.sendJoinFault(telemetry_1.FaultType.Error, telemetryMessage, e, this.reloadEvent);
                        break;
                    }
                }
                yield util_1.ExtensionUtil.showErrorAsync(e);
                vscode.commands.executeCommand('workbench.action.closeFolder');
                return;
            }
            vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            session_1.SessionContext.transition(session_1.SessionAction.JoiningSuccess);
            // Create debugger manager instances
            this.joinDebugManager = new joinDebugManager_1.JoinDebugManager(this.rpcClient, session_1.SessionContext.workspaceSessionInfo.id, this.hostAdapterService);
            yield this.joinDebugManager.initialize();
            // Create breakpoint manager
            yield this.createBreakpointManager(false);
            // Open shared terminals
            yield this.openSharedTerminalsOnJoin();
            yield WorkspaceTaskClient.enable(this.rpcClient, this.workspaceService);
            this.reloadEvent.addMeasure(telemetry_1.TelemetryPropertyNames.RELOAD_END_TIME, (new Date()).getTime());
            this.reloadEvent.end(telemetry_1.TelemetryResult.Success);
        });
    }
    ensureWorkspaceName(workspaceSessionInfo) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!workspaceSessionInfo) {
                return;
            }
            try {
                // update workspace name
                vscode.workspace.updateWorkspaceFolders(0, 1, {
                    uri: vscode.workspace.workspaceFolders[0].uri,
                    name: workspaceSessionInfo.name
                });
            }
            catch (err) {
                telemetry_1.Instance.sendFault(telemetry_1.TelemetryEventNames.UPDATE_WORKPSACE_NAME_FAIL, telemetry_1.FaultType.NonBlockingFault, `Workspace file write failed.`, err);
            }
        });
    }
    leaveCollaboration(skipUnjoin) {
        return __awaiter(this, void 0, void 0, function* () {
            session_1.SessionContext.coeditingClient.pauseProcessingFileSaveRequests();
            // Force a save of all files to prevent VS Code from popping up the "Save before closing?" dialog. Note that
            // the client is already disposed by now, so this will not send save requests. This needs to happen before
            // leaving the workspace, because saveAll() goes through the file service to check whether the files exist.
            let didSaveAll = yield vscode.workspace.saveAll(true);
            if (!didSaveAll) {
                session_1.SessionContext.coeditingClient.resumeProcessingFileSaveRequests();
                return false;
            }
            if (this.joinDebugManager) {
                this.joinDebugManager.dispose();
            }
            if (this.breakpointManager) {
                yield this.breakpointManager.dispose();
            }
            yield WorkspaceTaskClient.disable();
            if (session_1.SessionContext.State === session_1.SessionState.Shared) {
                // TODO: Support leaving a shared session without unsharing.
                yield this.endCollaboration();
                return;
            }
            else if (session_1.SessionContext.State !== session_1.SessionState.Joined) {
                throw new Error('Not currently in a collaboration session.');
            }
            const workspaceId = session_1.SessionContext.workspaceSessionInfo.id;
            session_1.SessionContext.transition(session_1.SessionAction.Unjoin);
            this.disposeCollaboratorCommands();
            if (!skipUnjoin) {
                yield this.workspaceService.unjoinWorkspaceAsync(workspaceId);
            }
            yield vscode.commands.executeCommand('workbench.action.closeFolder');
        });
    }
    signInToken() {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.IsSignedIn) {
                // Already signed in.
                vscode.window.showInformationMessage('You are already signed in.');
                return;
            }
            let userCode = yield vscode.window.showInputBox({
                prompt: 'Please enter your user code',
                ignoreFocusOut: true,
            });
            if (!userCode) {
                session_1.SessionContext.transition(session_1.SessionAction.SignInError);
                return;
            }
            return this.signIn({ isSilent: false, userCode });
        });
    }
    startSignInProcess(isSilent, prompt = true) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!isSilent) {
                yield this.openLoginPage(prompt);
            }
            // Only initiate the external sign-in listener if not already attempting to sign in
            if (session_1.SessionContext.State !== session_1.SessionState.ExternallySigningIn) {
                yield this.signIn({ isSilent });
            }
            return;
        });
    }
    signIn(options = {}) {
        return __awaiter(this, void 0, void 0, function* () {
            const { isSilent = false, userCode = '' } = options;
            if (session_1.SessionContext.IsSignedIn) {
                // Already signed in.
                return session_1.SessionContext.userInfo;
            }
            let signInEvent = new telemetry_1.TimedEvent(telemetry_1.TelemetryEventNames.SIGN_IN, true);
            signInEvent.addProperty(telemetry_1.TelemetryPropertyNames.SILENT_SIGN_IN, isSilent ? 'True' : 'False');
            signInEvent.addProperty(telemetry_1.TelemetryPropertyNames.SIGN_IN_WITH_CODE, userCode ? 'True' : 'False');
            try {
                session_1.SessionContext.transition(session_1.SessionAction.AttemptSignIn);
                let userInfo = yield this.signInHelper(options, signInEvent);
                if (userInfo) {
                    telemetry_1.Instance.setUserInfo(userInfo);
                    session_1.SessionContext.userInfo = userInfo;
                    session_1.SessionContext.transition(session_1.SessionAction.SignInSuccess);
                    signInEvent.end(telemetry_1.TelemetryResult.Success, 'Sign-in success');
                }
                else {
                    session_1.SessionContext.transition(session_1.SessionAction.SignInError);
                    //Intentionally abandon the signInEvent here. I.e. don't send it.
                    //This branch is hit when we try to sign in with a cached auth token
                    //on initialization and don't have one. Not interested in receiving
                    //telemetry for this case.
                }
                return userInfo;
            }
            catch (e) {
                signInEvent.end(telemetry_1.TelemetryResult.IndeterminateFailure, 'Sign-in failed.');
                telemetry_1.Instance.sendSignInFault(telemetry_1.FaultType.Unknown, 'Sign-in failed. ' + e.message, e);
                session_1.SessionContext.transition(session_1.SessionAction.SignInError);
                throw e;
            }
        });
    }
    // Opens the login page as an isolated side-effect
    openLoginPage(prompt = true, userActionCallback, signInEvent) {
        return __awaiter(this, void 0, void 0, function* () {
            const loginPage = yield this.authService.getLoginUriAsync();
            if (prompt) {
                const result = yield vscode.window.showInformationMessage(`Sign in to ${config.get(config.Key.name)} using a web browser.`, undefined, { title: 'Launch Sign In' });
                if (result) {
                    // Find login code, only if not already attempting to do so
                    session_1.SessionContext.transition(session_1.SessionAction.AwaitExternalSignIn);
                }
                if (userActionCallback) {
                    const notificationResult = result
                        ? SignInPromptUserAction.Proceed
                        : SignInPromptUserAction.Cancel;
                    userActionCallback(notificationResult);
                }
                if (!result)
                    return;
            }
            util_1.ExtensionUtil.openBrowser(`${loginPage}?extensionId=${this.extensionInstanceId}`);
            return;
        });
    }
    static getAuthTokenPayload(userCode) {
        // check if `code` or `token`
        return (Commands.userCodeRegex.test(userCode))
            ? { code: userCode }
            : { token: userCode };
    }
    signInHelper(options, signInEvent) {
        return __awaiter(this, void 0, void 0, function* () {
            const { isSilent = false, isJoining = false, signInPromptUserActionCallback } = options;
            let { userCode = '' } = options;
            userCode = userCode.trim();
            // logging in with user provided code
            if (userCode) {
                return yield this.signInWithProgress(Commands.getAuthTokenPayload(userCode), true, 'Signing in...', isSilent);
            }
            // Try to silently log in with cached credentials
            let userInfo = yield this.signInWithProgress(null, false, 'Signing in...');
            if (!userInfo) {
                if (isSilent) {
                    // Silent sign-in failed, and interactive sign-in was not requested.
                    session_1.SessionContext.transition(session_1.SessionAction.SignOut);
                    // Find login code, only if not already attempting to do so
                }
                else if (session_1.SessionContext.State !== session_1.SessionState.ExternallySigningIn) {
                    let loginCode = null;
                    if (isJoining) {
                        yield this.openLoginPage(true, signInPromptUserActionCallback, signInEvent);
                    }
                    else {
                        session_1.SessionContext.transition(session_1.SessionAction.AwaitExternalSignIn);
                    }
                    // if trying to extarnally sign in, report it to telemetry
                    const isExternallySigningIn = (session_1.SessionContext.State === session_1.SessionState.ExternallySigningIn);
                    if (isExternallySigningIn && signInEvent) {
                        signInEvent.addProperty(telemetry_1.TelemetryPropertyNames.SIGN_IN_WITH_BROWSER, 'True');
                    }
                    if (os.platform() === util.OSPlatform.LINUX) {
                        // auth.findLoginCodeAsync() is not implemented on Linux.
                        loginCode = yield vscode.window.showInputBox({
                            prompt: 'Sign in via the external browser, then paste the user code here.',
                            ignoreFocusOut: true,
                        });
                    }
                    else {
                        loginCode = yield this.authService.findLoginCodeAsync(this.extensionInstanceId);
                    }
                    if (!loginCode) {
                        session_1.SessionContext.transition(session_1.SessionAction.SignOut);
                        return null;
                    }
                    session_1.SessionContext.transition(session_1.SessionAction.AttemptSignIn);
                    userInfo = yield this.signInWithProgress({ code: loginCode }, true, 'Signing in...');
                }
            }
            return userInfo;
        });
    }
    initializeTelemetryAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            const telemetrySettings = yield this.telemetryService.initializeAsync({
                canCollectPII: config.get(config.Key.canCollectPII),
            });
            traceSource_1.Privacy.setKey(telemetrySettings.privacyKey);
        });
    }
    signInWithProgress(token, displayErrors, progressText, isSilent = true) {
        return util_1.ExtensionUtil.runWithProgress(() => __awaiter(this, void 0, void 0, function* () {
            try {
                session_1.SessionContext.transition(session_1.SessionAction.AttemptSignIn);
                // Initialize privacy settings before doing anything with user data.
                yield this.initializeTelemetryAsync();
                let userInfo = token
                    ? yield this.authService.loginAsync(token, {
                        cache: true,
                        cacheDefault: true
                    })
                    : yield this.authService.loginWithCachedTokenAsync({
                        accountId: config.get(config.Key.account),
                        providerName: config.get(config.Key.accountProvider),
                    });
                if (!userInfo && displayErrors) {
                    session_1.SessionContext.transition(session_1.SessionAction.SignInError);
                    if (isSilent) {
                        yield util_1.ExtensionUtil.showErrorAsync('Sign-in failed.');
                    }
                    else {
                        const signInAgainItem = { title: 'Sign in again' };
                        const result = yield util_1.ExtensionUtil.showErrorAsync('The user code is invalid or expired. Try signing in again.', undefined, [
                            signInAgainItem
                        ]);
                        if (result && result.title === signInAgainItem.title) {
                            this.startSignInProcess(false, false);
                        }
                    }
                }
                return userInfo;
            }
            catch (error) {
                // This error message should not be tied to a displayErrors since it indicates
                // missing dependency for Linux
                let { message } = error;
                if (os.platform() === util_1.OSPlatform.LINUX && message.includes('org.freedesktop.secrets')) {
                    yield util_1.ExtensionUtil.promptLinuxDependencyInstall('VS Live Share could not sign you in due to a missing or misconfigured keyring.');
                }
                else if (displayErrors) {
                    session_1.SessionContext.transition(session_1.SessionAction.SignInError);
                    if (error.code === ContractConstants_1.ErrorCodes.KeychainAccessFailed) {
                        const moreInfoItem = { title: 'More Info' };
                        const result = yield vscode.window.showErrorMessage(util_1.ExtensionUtil.getErrorString(ContractConstants_1.ErrorCodes.KeychainAccessFailed), { modal: true }, moreInfoItem);
                        if (result && result.title === moreInfoItem.title) {
                            util_1.ExtensionUtil.openBrowser('https://support.apple.com/en-us/HT201609');
                        }
                    }
                    else if (typeof error === 'string' && error.includes('secret_password_clear_sync')) {
                        const moreInfoResponse = 'More Info';
                        const response = yield vscode.window.showErrorMessage('VS Live Share could not sign you in due to a missing or misconfigured keyring. Please ensure that all required Linux dependencies are installed.', moreInfoResponse, 'OK');
                        if (response === moreInfoResponse) {
                            util_1.ExtensionUtil.openBrowser('https://aka.ms/vsls-docs/linux-prerequisites');
                        }
                    }
                    else {
                        // unknown error
                        yield util_1.ExtensionUtil.showErrorAsync(error);
                    }
                }
                return undefined;
            }
        }), progressText);
    }
    signOut() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!session_1.SessionContext.IsSignedIn) {
                yield vscode.window.showInformationMessage('Not signed in.');
                return;
            }
            if (session_1.SessionContext.IsStartingCollaboration) {
                yield util_1.ExtensionUtil.showErrorAsync('Cannot sign out while collaboration is starting.');
                return;
            }
            return util_1.ExtensionUtil.runWithProgress(() => this.signOutHelper(), 'Signing Out');
        });
    }
    signOutHelper() {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State === session_1.SessionState.Joined) {
                if (!(yield this.leaveCollaboration())) {
                    // We couldn't leave the collaboration (e.g. customer clicked
                    // cancel on a save prompt, for example)
                    return;
                }
            }
            else if (session_1.SessionContext.State === session_1.SessionState.Shared) {
                yield this.endCollaboration();
            }
            yield this.authService.logoutAsync({ cache: true });
            session_1.SessionContext.transition(session_1.SessionAction.SignOut);
        });
    }
    debug() {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State !== session_1.SessionState.Joined) {
                throw new Error('Not currently in a collaboration session.');
            }
            let debugSessions = this.joinDebugManager.getAvailableDebugSessions();
            if (debugSessions.length === 0) {
                yield vscode.window.showInformationMessage('No debug session available to join');
                return;
            }
            if (debugSessions.length === 1) {
                yield util_1.ExtensionUtil.runWithProgress(() => this.joinDebugManager.joinDebugSession(debugSessions[0]), 'Joining Debug Session...');
            }
            else {
                let items = [];
                debugSessions.forEach((d) => {
                    items.push({
                        label: d.name
                    });
                });
                let selection = (yield vscode.window.showQuickPick(items, { placeHolder: 'Select the debug session' }));
                if (selection) {
                    let debugSession = debugSessions.filter(item => item.name === selection.label)[0];
                    yield util_1.ExtensionUtil.runWithProgress(() => this.joinDebugManager.joinDebugSession(debugSession), 'Joining Debug Session...');
                }
            }
        });
    }
    showJoinMessageApprovalRequired(e, guestDisplayName) {
        return __awaiter(this, void 0, void 0, function* () {
            let messageString = `${guestDisplayName} wants to join your collaboration session. Allow them to join?`;
            let selection = yield vscode.window
                .showInformationMessage(messageString, ...['Yes', 'No']);
            yield this.workspaceUserService.acceptOrRejectGuestAsync(e.sessionNumber, (selection === 'Yes'));
        });
    }
    showJoinMessageAutoApprove(e, guestDisplayName) {
        return __awaiter(this, void 0, void 0, function* () {
            let messageString = `${guestDisplayName} joined your collaboration session.`;
            yield this.acceptSemaphore.acquire();
            let selection = yield vscode.window.showInformationMessage(messageString, ...['Remove']);
            this.acceptSemaphore.release();
            if (selection === 'Remove') {
                yield this.workspaceUserService.removeUserAsync(e.sessionNumber);
            }
        });
    }
    onWorkspaceSessionChanged(e) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Notify listeners of the session changing, *before* we go through the accept/reject flow
                // to ensure that the various internal states for displaying information have the latest
                // info. A primary example of this is that in the Notify mode, we shouldn't wait to notify
                // others that someone has joined -- this means all the user info etc is correct.
                // In the approval mode, this doesn't cause issues, because the collaborator interactions
                // are driven by the by co-editing counts, not just the simple join message.
                // Note: CollaboratorManager needs to be updated first because the status bar queries it to know the updated
                // list of co-editors.
                if (session_1.SessionContext.collaboratorManager) {
                    session_1.SessionContext.collaboratorManager.onWorkspaceSessionChanged(e);
                }
                if (this.statusBarController) {
                    this.statusBarController.onWorkspaceSessionChanged(e);
                }
                if (session_1.SessionContext.coeditingClient) {
                    session_1.SessionContext.coeditingClient.onWorkspaceSessionChanged(e);
                }
                if (e.changeType === wt.WorkspaceSessionChangeType.Joined && session_1.SessionContext.State === session_1.SessionState.Shared) {
                    if (config.featureFlags.guestApproval) {
                        let name = e.userProfile.name;
                        let email = e.userProfile.email;
                        let guestDisplayName = name ? `${name} (${email})` : email;
                        if (config.get(config.Key.guestApprovalRequired)) {
                            yield this.workspaceUserService.fireProgressUpdatedToGuest(wt.WorkspaceProgress.WaitingForHost, e.sessionNumber);
                            yield this.showJoinMessageApprovalRequired(e, guestDisplayName);
                        }
                        else {
                            yield this.workspaceUserService.acceptOrRejectGuestAsync(e.sessionNumber, true);
                            yield this.showJoinMessageAutoApprove(e, guestDisplayName);
                        }
                    }
                    else {
                        yield this.workspaceUserService.acceptOrRejectGuestAsync(e.sessionNumber, true);
                    }
                }
            }
            catch (e) {
                traceSource_1.traceSource.error(e);
            }
        });
    }
    onWorkspaceConnectionStatusChanged(e) {
        return __awaiter(this, void 0, void 0, function* () {
            if (e.connectionStatus === wt.WorkspaceConnectionStatus.Disconnected &&
                e.disconnectedReason !== wt.WorkspaceDisconnectedReason.Requested) {
                if (session_1.SessionContext.State === session_1.SessionState.Joined) {
                    let message;
                    let isError = false;
                    switch (e.disconnectedReason) {
                        case wt.WorkspaceDisconnectedReason.SessionEnded:
                            message = 'The owner has ended the current collaboration session. ' +
                                'Open folders and editors will now close.';
                            break;
                        case wt.WorkspaceDisconnectedReason.SessionExpired:
                            message = 'The collaboration session expired. ' +
                                'Please sign in and try again.';
                            isError = true;
                            break;
                        case wt.WorkspaceDisconnectedReason.UserRemoved:
                            message = 'You have been removed from the collaboration session.';
                            break;
                        case wt.WorkspaceDisconnectedReason.ConnectionLost:
                            message = 'You were disconnected from the collaboration session ' +
                                'due to a connectivity problem or the owner going offline. ' +
                                'Join again to retry.';
                            isError = true;
                            break;
                        case wt.WorkspaceDisconnectedReason.InternalError:
                        default:
                            message = 'The collaboration session has disconnected ' +
                                'due to an internal error.';
                            isError = true;
                            break;
                    }
                    if (isError) {
                        yield vscode.window.showErrorMessage(message, { modal: true });
                    }
                    else {
                        yield vscode.window.showInformationMessage(message, { modal: true });
                    }
                    yield this.leaveCollaboration(true);
                }
                else if (session_1.SessionContext.State === session_1.SessionState.Shared &&
                    e.disconnectedReason !== wt.WorkspaceDisconnectedReason.SessionEnded) {
                    let message;
                    switch (e.disconnectedReason) {
                        case wt.WorkspaceDisconnectedReason.SessionExpired:
                            message = 'The collaboration session expired. ' +
                                'Please sign in and try again.';
                            yield this.signOut(); /* calls endCollaboration internally */
                            break;
                        case wt.WorkspaceDisconnectedReason.InternalError:
                        default:
                            message = 'The collaboration session has ended due to an internal error.';
                            yield this.endCollaboration();
                            break;
                    }
                    yield util_1.ExtensionUtil.showErrorAsync(message, { modal: true });
                }
            }
        });
    }
    onWorkspaceProgressUpdated(e) {
        switch (e.progress) {
            case wt.WorkspaceProgress.WaitingForHost: {
                if (this.reloadEvent) {
                    this.reloadEvent.markTime(telemetry_1.TelemetryPropertyNames.START_WAITING_FOR_HOST);
                }
                if (this.joinProgress) {
                    this.joinProgress.report({ message: util_1.ExtensionUtil.getProgressUpdateString(e.progress) });
                }
                break;
            }
            case wt.WorkspaceProgress.DoneWaitingForHost: {
                // No progress message update: the OpeningRemoteSession update immediately follows.
                break;
            }
            case wt.WorkspaceProgress.OpeningRemoteSession:
            case wt.WorkspaceProgress.JoiningRemoteSession: {
                if (this.joinProgress) {
                    this.joinProgress.report({ message: util_1.ExtensionUtil.getProgressUpdateString(e.progress) });
                }
                break;
            }
            case wt.WorkspaceProgress.OpenedRemoteSession:
            case wt.WorkspaceProgress.JoinedRemoteSession: {
                // No progress message update: the progress spinner will be removed since joining is complete.
                break;
            }
            default: {
                let event = new telemetry_1.TelemetryEvent(telemetry_1.TelemetryEventNames.REPORT_AGENTPROGRESS, true);
                event.addProperty(telemetry_1.TelemetryPropertyNames.EVENT_MESSAGE, e.progress);
                event.addMeasure(telemetry_1.TelemetryPropertyNames.PROGRESS_DURATION, e.duration);
                event.send();
                break;
            }
        }
    }
    summonParticipants() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!session_1.SessionContext.coeditingClient) {
                return;
            }
            session_1.SessionContext.coeditingClient.postMessage(coauthoringService_1.MessageFactory.SummonMessage(session_1.SessionContext.coeditingClient.clientID));
        });
    }
    listSharedServers(origin) {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State === session_1.SessionState.Joined) {
                yield this.listForwardedPorts();
            }
            else if (session_1.SessionContext.State === session_1.SessionState.Shared) {
                yield this.listSharedPorts();
            }
            else {
                throw new Error('Not currently in a collaboration session.');
            }
            portForwardingTelemetry_1.PortForwardingTelemetry.listSharedLocalServers(origin);
        });
    }
    listSharedPorts() {
        return __awaiter(this, void 0, void 0, function* () {
            const sharedServers = yield this.serverSharingService.getSharedServersAsync();
            if (sharedServers.length === 0) {
                yield vscode.window.showInformationMessage('No TCP ports are currently shared in the collaboration session.', { modal: false });
                return;
            }
            const items = sharedServers.map((s) => `localhost:${s.sourcePort}` + (s.sessionName === `localhost:${s.sourcePort}` ? '' : ` shared as '${s.sessionName}'`));
            yield vscode.window.showQuickPick(items, { placeHolder: 'The following local TCP ports are exposed in the collaboration session' });
        });
    }
    listForwardedPorts() {
        return __awaiter(this, void 0, void 0, function* () {
            const sharedServers = yield this.portForwardingService.getSharedServersAsync();
            if (sharedServers.length === 0) {
                yield vscode.window.showInformationMessage('No TCP ports are currently shared in the collaboration session.', { modal: false });
                return;
            }
            let index = -1;
            if (sharedServers.length === 1) {
                index = 0;
            }
            else {
                const items = sharedServers.map((s) => s.sessionName === `localhost:${s.destinationPort}` ? s.sessionName : `${s.sessionName} mapped to localhost:${s.destinationPort}`);
                const selection = yield vscode.window.showQuickPick(items, { placeHolder: 'Select exposed TCP port to copy to clipboard' });
                if (!selection) {
                    return;
                }
                index = items.indexOf(selection);
            }
            if (index >= 0) {
                const server = sharedServers[index];
                const text = `localhost:${server.destinationPort}`;
                const forSessionName = server.sessionName === text ? '' : ` for ${server.sessionName}`;
                yield clipboardy_1.write(text);
                const result = yield vscode.window.showInformationMessage(`'${text}'${forSessionName} copied to clipboard.`, { title: 'Copy again' });
                if (result) {
                    yield clipboardy_1.write(text);
                }
            }
        });
    }
    shareServer(origin) {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State !== session_1.SessionState.Shared) {
                throw new Error('Not currently hosting a collaboration session.');
            }
            const sharedServers = yield this.serverSharingService.getSharedServersAsync();
            function validatePortNumber(value) {
                if (value !== undefined && value !== '') {
                    const n = parseFloat(value);
                    if (isNaN(n) || !Number.isInteger(n) || n <= 0 || n > 65535) {
                        return 'The port number must be an integer in range 1 - 65535';
                    }
                    const s = sharedServers.find(server => server.sourcePort === n);
                    if (s) {
                        return `Local TCP port ${n} is already being shared${s.sessionName === `localhost:${s.sourcePort}` ? '' : ` as '${s.sessionName}'`}`;
                    }
                }
                return null;
            }
            const portValue = yield vscode.window.showInputBox({
                prompt: 'Enter port to expose to collaborators',
                ignoreFocusOut: true,
                validateInput: validatePortNumber,
            });
            if (portValue === undefined || portValue === '') {
                return;
            }
            const port = parseFloat(portValue);
            const sessionName = yield vscode.window.showInputBox({
                value: `localhost:${port}`,
                prompt: '[Optional] Name the port for reference by collaborators',
                ignoreFocusOut: true,
            });
            const sharedServer = yield this.serverSharingService.startSharingAsync(port, sessionName);
            const asSessionName = sharedServer.sessionName === `localhost:${port}` ? '' : ` as '${sharedServer.sessionName}'`;
            portForwardingTelemetry_1.PortForwardingTelemetry.shareServer(port, origin);
            yield vscode.window.showInformationMessage(`Exposed local TCP port ${port}${asSessionName} in the collaboration session.`, { modal: false });
        });
    }
    unshareServer(origin) {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State !== session_1.SessionState.Shared) {
                throw new Error('Not currently hosting a collaboration session.');
            }
            const sharedServers = yield this.serverSharingService.getSharedServersAsync();
            if (sharedServers.length === 0) {
                yield vscode.window.showInformationMessage('No local TCP ports are currently shared in the collaboration session.', { modal: false });
                return;
            }
            const getServerName = (s) => `localhost:${s.sourcePort}` + (s.sessionName === `localhost:${s.sourcePort}` ? '' : ` shared as '${s.sessionName}'`);
            let server;
            if (sharedServers.length === 1) {
                server = sharedServers[0];
            }
            else {
                const items = sharedServers.map(getServerName);
                items.unshift('<All Shared TCP ports>');
                const selection = yield vscode.window.showQuickPick(items, { placeHolder: 'Pick local TCP port to stop sharing in the collaboration session' });
                if (!selection) {
                    return;
                }
                const index = items.indexOf(selection);
                if (index < 0) {
                    return;
                }
                server = index > 0 ? sharedServers[index - 1] : null;
            }
            if (server) {
                yield this.serverSharingService.stopSharingAsync(server.sourcePort);
                portForwardingTelemetry_1.PortForwardingTelemetry.unshareServer(server.sourcePort, origin);
                yield vscode.window.showInformationMessage(`Stopped sharing ${getServerName(server)} in the collaboration session.`, { modal: false });
            }
            else {
                for (server of sharedServers) {
                    yield this.serverSharingService.stopSharingAsync(server.sourcePort);
                    portForwardingTelemetry_1.PortForwardingTelemetry.unshareServer(server.sourcePort, origin);
                }
                yield vscode.window.showInformationMessage('Stopped sharing all previousely shared local TCP ports in the collaboration session.', { modal: false });
            }
        });
    }
    shareTerminal(origin) {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State !== session_1.SessionState.Shared) {
                throw new Error('Not currently hosting a collaboration session.');
            }
            this.throwIfSharedTerminalsNotEnabled();
            const guestsCanWriteChoice = yield vscode.window.showQuickPick(['Read-only', 'Read/write'], { placeHolder: 'Select the access level guests should have for this terminal' });
            if (guestsCanWriteChoice === undefined) {
                return;
            }
            const cfg = vscode.workspace.getConfiguration();
            const configShellProperty = `terminal.integrated.shell.${util.getPlatformProperty()}`;
            const configShell = cfg.get(configShellProperty);
            if (!configShell) {
                throw new Error(`Terminal shell configuration property "${configShellProperty}" is empty`);
            }
            const shellBasename = path.basename(configShell).toLowerCase();
            // Use 'ps' to shorten the terminal name for powershell. The terminal name lengh is limited by the terminal drop down width in VSCode.
            const shortName = shellBasename === 'powershell.exe' ? 'ps' : path.basename(shellBasename, path.extname(shellBasename));
            const configArgs = cfg.get(`terminal.integrated.shellArgs.${util.getPlatformProperty()}`) || [];
            const configEnv = cfg.get(`terminal.integrated.env.${util.getPlatformProperty()}`);
            let options = {
                name: `${shortName} [Shared]`,
                rows: config.get(config.Key.sharedTerminalHeight),
                cols: config.get(config.Key.sharedTerminalWidth),
                cwd: cfg.get('terminal.integrated.cwd') || vscode.workspace.rootPath,
                app: configShell,
                commandLine: configArgs,
                environment: configEnv,
                readOnlyForGuests: guestsCanWriteChoice === 'Read-only',
            };
            const terminalInfo = yield this.terminalService.startTerminalAsync(options);
            this.createTerminal(terminalInfo);
        });
    }
    listSharedTerminals(origin) {
        return __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State !== session_1.SessionState.Shared && session_1.SessionContext.State !== session_1.SessionState.Joined) {
                throw new Error('Not currently in a collaboration session.');
            }
            const terminals = yield this.getRunningTerminalsAsync();
            if (terminals.length === 0) {
                yield vscode.window.showInformationMessage('No terminals are currently shared in the collaboration session.', { modal: false });
                return;
            }
            let index = -1;
            if (terminals.length === 1) {
                index = 0;
            }
            else {
                const items = terminals.map((t, i) => `${i + 1}: ${t.options.name}`);
                const selection = yield vscode.window.showQuickPick(items, { placeHolder: 'Select shared terminal to open' });
                if (!selection) {
                    return;
                }
                index = items.indexOf(selection);
            }
            if (index >= 0) {
                this.createTerminal(terminals[index]);
            }
        });
    }
    openSharedTerminalsOnJoin() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const terminals = yield this.getRunningTerminalsAsync();
                session_1.SessionContext.HasSharedTerminals = terminals.length > 0;
                terminals.forEach(this.createTerminal, this);
            }
            catch (_a) {
                session_1.SessionContext.HasSharedTerminals = false;
            }
        });
    }
    createTerminal(info) {
        this.createIntegratedTerminal(info);
        // TODO: enable when external terminal is supported
        // if (config.get<string>(config.Key.sharedTerminalWindow) === 'Integrated') {
        // } else {
        //     this.createExternalTerminal(info);
        // }
    }
    createExternalTerminal(info) {
        const command = agent_1.Agent.getAgentPath();
        const args = [
            '--terminal', info.localPipeName,
            '--title', `Shared Terminal for ${session_1.SessionContext.workspaceSessionInfo.name} : ${info.options.name}`,
            '--terminalWidth', config.get(config.Key.sharedTerminalWidth).toString(),
            '--terminalHeight', config.get(config.Key.sharedTerminalHeight).toString(),
        ];
        const cp = child_process.spawn(command, args, { stdio: 'ignore', detached: true });
        cp.once('exit', (e, code) => {
            if (session_1.SessionContext.State === session_1.SessionState.Shared) {
                unsubscribeEvents();
                this.terminalService.stopTerminalAsync(info.id);
            }
        });
        const onTerminalStopped = (e) => {
            if (e.terminal.id === info.id) {
                cp.kill();
                unsubscribeEvents();
            }
        };
        const unsubscribeEvents = () => {
            this.terminalService.removeListener(service_1.TerminalService.terminalStoppedEvent, onTerminalStopped);
        };
    }
    createIntegratedTerminal(info) {
        if (this.integratedTerminals.has(info.id)) {
            this.integratedTerminals.get(info.id).show();
            return;
        }
        const terminalOptions = {
            name: info.options.name,
            shellPath: agent_1.Agent.getAgentPath(),
            shellArgs: ['--terminal', info.localPipeName],
        };
        const terminal = vscode.window.createTerminal(terminalOptions);
        terminal.show();
        this.integratedTerminals.set(info.id, terminal);
        const eventRegistration = vscode.window.onDidCloseTerminal((t) => __awaiter(this, void 0, void 0, function* () {
            if (t === terminal) {
                unsubscribeEvents();
                if (session_1.SessionContext.State === session_1.SessionState.Shared) {
                    yield this.terminalService.stopTerminalAsync(info.id);
                }
            }
        }));
        const onTerminalStopped = (e) => {
            if (e.terminal.id === info.id) {
                unsubscribeEvents();
                terminal.dispose();
            }
        };
        const unsubscribeEvents = () => {
            this.integratedTerminals.delete(info.id);
            eventRegistration.dispose();
            this.terminalService.removeListener(service_1.TerminalService.terminalStoppedEvent, onTerminalStopped);
        };
        this.terminalService.onTerminalStopped(onTerminalStopped);
    }
    hostAdapterService_RunInTerminal(args) {
        return __awaiter(this, void 0, void 0, function* () {
            const shareKind = config.get(config.Key.shareDebugTerminal);
            if (session_1.SessionContext.State !== session_1.SessionState.Shared
                || shareKind === 'off'
                || !config_1.featureFlags.sharedTerminals
                || !config_1.featureFlags.shareDebugTerminal
                || !args.args) {
                return null;
            }
            let options = {
                name: `${args.title} [Shared]`,
                rows: config.get(config.Key.sharedTerminalHeight),
                cols: config.get(config.Key.sharedTerminalWidth),
                cwd: args.cwd || vscode.workspace.rootPath,
                environment: args.env,
                readOnlyForGuests: shareKind !== 'readWrite',
                isSharedDebugTerminal: true,
            };
            if (os.platform() === util.OSPlatform.WINDOWS) {
                const isWoW64 = !!process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
                options.app = `${process.env.windir ? process.env.windir : 'C:'}\\${isWoW64 ? 'Sysnative' : 'System32'}\\cmd.exe`;
                options.verbatimCommandLine = true,
                    options.commandLine = ['/c', `""${args.args.join('" "')}""`];
            }
            else {
                options.app = 'bash';
                options.commandLine = ['-c', `'${args.args.join('\' \'')}'`];
            }
            const terminalInfo = yield this.terminalService.startTerminalAsync(options);
            args.args = [agent_1.Agent.getAgentPath(), '--terminal', terminalInfo.localPipeName];
            return { args };
        });
    }
    getRunningTerminalsAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.terminalService.getRunningTerminalsAsync();
            }
            catch (e) {
                if (e.code === -32601) {
                    // Other side doesn't have terminal service
                    return [];
                }
                throw e;
            }
        });
    }
    throwIfSharedTerminalsNotEnabled() {
        if (!config_1.featureFlags.sharedTerminals) {
            throw new Error('Shared terminal feature is not enabled');
        }
    }
    setupCollaboratorCommands() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.setupPinCommand();
        });
    }
    setupPinCommand() {
        return __awaiter(this, void 0, void 0, function* () {
            yield util_1.ExtensionUtil.tryRegisterCommand(Commands.pinCommandId, (textEditor, edit, args) => {
                if (!session_1.SessionContext.coeditingClient || !session_1.SessionContext.collaboratorManager) {
                    return;
                }
                const coEditors = session_1.SessionContext.collaboratorManager.getCollaboratorSessionIds();
                const coEditorCount = coEditors.length;
                if (coEditorCount < 1) {
                    return;
                }
                // args will be a boolean with the value of true if invoked via listParticipants
                let alwaysShowParticipants = false;
                if (typeof (args) === 'boolean') {
                    alwaysShowParticipants = args;
                }
                if (coEditorCount === 1 && !alwaysShowParticipants) {
                    session_1.SessionContext.coeditingClient.pin(textEditor, coEditors[0]);
                }
                else {
                    const placeHolder = alwaysShowParticipants
                        ? coEditorCount + ' participant locations(s) listed below. Select one to follow or press \'Escape\' when done.'
                        : 'Select a participant to follow';
                    const picks = coEditors.map((sessionId) => {
                        const displayName = session_1.SessionContext.collaboratorManager.getDisplayName(sessionId);
                        const lastKnownFile = session_1.SessionContext.coeditingClient.lastKnownFileForClient(sessionId);
                        return {
                            description: displayName,
                            detail: lastKnownFile ? `Currently editing ${lastKnownFile}` : 'Not currently editing a shared document',
                            label: '$(file-symlink-file)',
                            targetSessionId: sessionId
                        };
                    });
                    return vscode.window
                        .showQuickPick(picks, { placeHolder })
                        .then(pick => (pick && session_1.SessionContext.coeditingClient.pin(textEditor, pick.targetSessionId)));
                }
            }, undefined, /* isEditorCommand */ true);
            yield util_1.ExtensionUtil.tryRegisterCommand(Commands.unpinCommandId, (textEditor, edit, args) => {
                if (!session_1.SessionContext.coeditingClient) {
                    return;
                }
                session_1.SessionContext.coeditingClient.unpinByEditor(textEditor, /* explicit */ true);
            }, undefined, /* isEditorCommand */ true);
        });
    }
    listParticipants(origin) {
        return __awaiter(this, void 0, void 0, function* () {
            yield vscode.commands.executeCommand(Commands.pinCommandId, true);
        });
    }
    disposeCollaboratorCommands() {
        util_1.ExtensionUtil.disposeCommand(Commands.pinCommandId);
        util_1.ExtensionUtil.disposeCommand(Commands.unpinCommandId);
    }
    exportLogsAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            const saveUri = yield vscode.window.showSaveDialog({
                filters: { 'Zipped Log Files': ['zip'] },
            });
            if (!saveUri || !saveUri.fsPath)
                return;
            const zipFilePath = saveUri.fsPath;
            yield vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, () => __awaiter(this, void 0, void 0, function* () {
                yield logZipExporter_1.LogZipExporter.createLogZipFileAsync(zipFilePath, logFileTraceListener_1.LogFileTraceListener.defaultLogDirectory);
                yield clipboardy_1.write(zipFilePath);
                vscode.window.showInformationMessage(`Logs exported to ${zipFilePath} (path copied to clipboard)`);
            }));
        });
    }
}
Commands.pinCommandId = 'liveshare.pinTo';
Commands.unpinCommandId = 'liveshare.unpin';
Commands.stateCommandContext = 'liveshare:state';
Commands.hasCollaboratorsCommandContext = 'liveshare:hasCollaborators';
Commands.pinnableCommandContext = 'liveshare:isPinnable';
Commands.pinnedCommandContext = 'liveshare:isPinned';
Commands.isCollaboratingCommandContext = 'liveshare:isCollaborating';
Commands.isServerSharedCommandContext = 'liveshare:isServerShared';
Commands.hasSharedTerminalsCommandContext = 'liveshare:hasSharedTerminals';
Commands.supportSharedTerminalsCommandContext = 'liveshare:supportSharedTerminals';
Commands.supportSummonParticipantsCommandContext = 'liveshare:supportSummonParticipants';
Commands.logsEnabled = 'liveshare:logsEnabled';
Commands.joinWorkspaceIdSettingName = 'vsliveshare.join.reload.workspaceId';
Commands.joinWorkspaceIdFolderSettingName = 'vsliveshare.join.reload.workspaceFolder';
Commands.listParticipantsCommandId = 'liveshare.listParticipants';
Commands.joinLinkRegex = /^https?:\/\/.*\/join\/?\?([0-9A-Z]+)$/i;
Commands.userCodeRegex = /^(([a-z]{4}\-){3})(([a-z]{4}){1})$/i;
Commands.cascadeLauncherScheme = `${config.get(config.Key.scheme)}:`;
Commands.cascadeLinkRegex = new RegExp(`${Commands.cascadeLauncherScheme}\?.*join.*workspaceId=([0-9A-Z-]+)`, 'i');
exports.Commands = Commands;

//# sourceMappingURL=commands.js.map
