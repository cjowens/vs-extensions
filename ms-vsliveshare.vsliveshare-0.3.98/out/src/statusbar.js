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
const util_1 = require("./util");
const wt = require("./workspace/contract/WorkspaceServiceTypes");
const session_1 = require("./session");
const config = require("./config");
const commands_1 = require("./commands");
const portForwardingTelemetry_1 = require("./telemetry/portForwardingTelemetry");
/**
 * Defines the appearance and behavior of the Cascade status bar items.
 */
class StatusBarController {
    constructor(commandEnabledCallback) {
        this.commandEnabledCallback = commandEnabledCallback;
        this.updateStatusBarPromise = Promise.resolve();
        this.userStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 4);
        this.userStatusBarItem.hide();
        this.collabStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 3);
        this.collabStatusBarItem.hide();
        this.updateStatusBar(new InitialState());
        session_1.SessionContext.addListener(session_1.SessionEvents.StateChanged, (newState, previousState) => __awaiter(this, void 0, void 0, function* () {
            return yield this.onSessionStateChanged(newState);
        }));
    }
    onSessionStateChanged(newState) {
        return __awaiter(this, void 0, void 0, function* () {
            let newStatusBarState = this.getStatusBarState(newState);
            this.updateStatusBarPromise = this.updateStatusBarPromise.then(() => __awaiter(this, void 0, void 0, function* () {
                yield this.updateStatusBar(newStatusBarState);
            }));
        });
    }
    getStatusBarState(state) {
        switch (state) {
            case session_1.SessionState.Initializing:
                return new InitialState();
            case session_1.SessionState.SigningIn:
                return new SigningInState();
            case session_1.SessionState.ExternallySigningIn:
                // same as signed out state
                return new SignedOutState();
            case session_1.SessionState.SignedIn:
                return new SignedInState();
            case session_1.SessionState.SharingInProgress:
                return new SharingInProgressState();
            case session_1.SessionState.Shared:
                return new SharedState();
            case session_1.SessionState.JoiningInProgress:
                return new JoiningState();
            case session_1.SessionState.Joined:
                return new JoinedState(this.commandEnabledCallback);
            default:
            case session_1.SessionState.SignedOut:
                return new SignedOutState();
        }
    }
    /**
     * Updates the status bar.
     *
     * @param newState the new state of the status bar.
     */
    updateStatusBar(newState) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.disposed) {
                this.currentState = newState;
                yield newState.updateUserStatusBarItem(this.userStatusBarItem);
                yield newState.updateCollabStatusBarItem(this.collabStatusBarItem);
            }
        });
    }
    /**
     * Registers listeners to certain co-editing events to update the status bar appropriately.
     *
     * @param client The local collaboration client object.
     */
    registerClientListeners(client) {
        client.onCoEditorSwitchedFile((sessionId, newFileName) => __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State === session_1.SessionState.Joined || session_1.SessionContext.State === session_1.SessionState.Shared) {
                yield this.currentState.onCoEditorSwitchedFile(sessionId, newFileName, this.collabStatusBarItem);
            }
        }));
        client.onCoEditorsJoined((joinerIds) => __awaiter(this, void 0, void 0, function* () {
            if (session_1.SessionContext.State === session_1.SessionState.Joined || session_1.SessionContext.State === session_1.SessionState.Shared) {
                yield this.currentState.onCoEditorsJoined(joinerIds, this.collabStatusBarItem);
            }
        }));
    }
    /**
     * Triggers an update on the collaboration status item when the session changes.
     *
     * @param e The event data.
     */
    onWorkspaceSessionChanged(e) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.currentState instanceof CollaborationState && e.changeType === wt.WorkspaceSessionChangeType.Unjoined) {
                yield this.currentState.onCoEditorLeft(e.sessionNumber, this.collabStatusBarItem);
            }
        });
    }
    /**
     * Called when the extension is unloaded.
     */
    dispose() {
        this.updateStatusBar(new InitialState());
        this.disposed = true;
    }
}
exports.StatusBarController = StatusBarController;
/**
 * Base class for the status bar states.
 */
class StatusBarState {
    /**
     * Utility method for completely hiding a status bar item.
     * @param item the item to hide.
     */
    hideItem(item) {
        item.hide();
        item.text = undefined;
        item.command = undefined;
        item.tooltip = undefined;
    }
}
exports.StatusBarState = StatusBarState;
/**
 * Defines the status bar behavior when VSCode is started. Nothing is shown in the status bar.
 * This is just the initial state, we transition to a different state as soon as extension activation is completed.
 */
class InitialState extends StatusBarState {
    updateUserStatusBarItem(currentUserItem) {
        return __awaiter(this, void 0, void 0, function* () {
            this.hideItem(currentUserItem);
        });
    }
    updateCollabStatusBarItem(collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            this.hideItem(collaboratorsItem);
        });
    }
}
exports.InitialState = InitialState;
/**
 * Defines the status bar behavior when the user is signed out.
 */
class SignedOutState extends StatusBarState {
    updateUserStatusBarItem(currentUserItem) {
        return __awaiter(this, void 0, void 0, function* () {
            currentUserItem.text = '$(person) Sign in';
            currentUserItem.command = `${config.get(config.Key.commandPrefix)}.signin.browser`;
            currentUserItem.tooltip = `Sign in to enable ${config.get(config.Key.name)} collaboration.`;
            currentUserItem.show();
        });
    }
    updateCollabStatusBarItem(collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            this.hideItem(collaboratorsItem);
        });
    }
}
exports.SignedOutState = SignedOutState;
/**
 * Defines the status bar behavior when the user is signing in but not yet connected.
 */
class SigningInState extends StatusBarState {
    updateUserStatusBarItem(currentUserItem) {
        return __awaiter(this, void 0, void 0, function* () {
            currentUserItem.hide();
        });
    }
    updateCollabStatusBarItem(collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            this.hideItem(collaboratorsItem);
        });
    }
}
exports.SigningInState = SigningInState;
/**
 * Defines the status bar behavior when the user is signed in.
 */
class SignedInState extends StatusBarState {
    constructor(userInfo = session_1.SessionContext.userInfo) {
        super();
        this.userInfo = userInfo;
        this.currentUserQuickPickItems = [
            {
                label: '$(link-external) Start Collaboration Session',
                description: '',
                detail: 'Start a collaboration session to share content and invite participants.',
                command: 'liveshare.start',
                enabled: () => true
            },
            {
                label: '$(organization) Join Collaboration Session',
                description: '',
                detail: 'Join a collaboration session to access shared content.',
                command: 'liveshare.join',
                enabled: () => true
            },
            {
                label: '$(sign-out) Sign Out',
                description: '',
                detail: `Sign out of your ${config.get(config.Key.name)} account.`,
                command: `${config.get(config.Key.commandPrefix)}.signout`,
                enabled: () => true
            }
        ];
    }
    updateUserStatusBarItem(currentUserItem) {
        return __awaiter(this, void 0, void 0, function* () {
            const commandId = '_liveshare.showSignedInUserOptions';
            yield util_1.ExtensionUtil.tryRegisterCommand('_liveshare.showSignedInUserOptions', () => {
                return this.showQuickPick(this.currentUserQuickPickItems, { placeHolder: 'What would you like to do?' })
                    .then(pick => pick && vscode.commands.executeCommand(pick.command, pick.commandArg));
            });
            currentUserItem.text = `$(person) ${this.signedInName}`;
            currentUserItem.command = commandId;
            currentUserItem.tooltip = `Signed in to ${config.get(config.Key.name)}${this.signedInInfo}`;
            currentUserItem.show();
        });
    }
    updateCollabStatusBarItem(collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            collaboratorsItem.text = '$(link-external) Share';
            collaboratorsItem.command = 'liveshare.start';
            collaboratorsItem.tooltip = 'Start Collaboration Session';
            collaboratorsItem.show();
        });
    }
    /**
     * Conditionally shows quick pick items based on whether they are enabled or not.
     */
    showQuickPick(items, options) {
        return vscode.window.showQuickPick(items.filter(item => item.enabled()), options);
    }
    get signedInName() {
        if (this.userInfo.displayName) {
            const firstName = this.userInfo.displayName.replace(/ .*$/, '');
            return firstName;
        }
        else {
            return this.userInfo.emailAddress || 'Signed In';
        }
    }
    get signedInInfo() {
        if (this.userInfo.displayName) {
            return ' as ' + this.userInfo.displayName +
                (this.userInfo.emailAddress ? ' <' + this.userInfo.emailAddress + '>' : '') +
                ' (' + this.userInfo.providerName + ')';
        }
        else {
            return (this.userInfo.emailAddress ? ' as ' + this.userInfo.emailAddress : '') +
                ' (' + this.userInfo.providerName + ')';
        }
    }
}
exports.SignedInState = SignedInState;
/**
 * Defines the status bar behavior when the user has clicked 'share' but the session has not yet started.
 */
class SharingInProgressState extends SignedInState {
    updateCollabStatusBarItem(collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            collaboratorsItem.hide();
        });
    }
    updateUserStatusBarItem(currentUserItem) {
        const _super = name => super[name];
        return __awaiter(this, void 0, void 0, function* () {
            yield _super("updateUserStatusBarItem").call(this, currentUserItem);
            // No commands are available in this state, apart, maybe "Cancel sharing" when we have it.
            currentUserItem.command = undefined;
        });
    }
}
exports.SharingInProgressState = SharingInProgressState;
/**
 * Defines the status bar behavior when the user has clicked 'join' but has not yet joined.
 */
class JoiningState extends SignedInState {
    updateCollabStatusBarItem(collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            collaboratorsItem.hide();
        });
    }
    updateUserStatusBarItem(currentUserItem) {
        const _super = name => super[name];
        return __awaiter(this, void 0, void 0, function* () {
            yield _super("updateUserStatusBarItem").call(this, currentUserItem);
            // No commands are available in this state, apart, maybe "Cancel joining" when we have it.
            currentUserItem.command = undefined;
        });
    }
}
exports.JoiningState = JoiningState;
/**
 * Defines the behavior of the collaboration status item for both the sharer and the joiners.
 * Other status items are not handled in this class.
 */
class CollaborationState extends SignedInState {
    constructor() {
        super(session_1.SessionContext.userInfo);
    }
    updateCollabStatusBarItem(collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.innerUpdateCollabStatusBarItem(collaboratorsItem, /* textOnly */ false);
        });
    }
    onCoEditorSwitchedFile(sessionId, newFileName, collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            // If there is a single remote collaborator, we need to update the tooltip of the collaboration item. If there
            // are more than one collaborator, the quick picks menu is always re-created on the fly, so we don't have to
            // update anything.
            if (session_1.SessionContext.collaboratorManager.getCollaboratorCount() === 1) {
                return this.innerUpdateCollabStatusBarItem(collaboratorsItem, /* textOnly */ true);
            }
        });
    }
    onCoEditorsJoined(joinerIds, collaboratorsItem) {
        return __awaiter(this, void 0, void 0, function* () {
            // If we had 1 or more collaborators, the command was already registered, so only update the text.
            const previousCount = session_1.SessionContext.collaboratorManager.getCollaboratorCount() - joinerIds.length;
            return this.innerUpdateCollabStatusBarItem(collaboratorsItem, /* textOnly */ previousCount >= 1);
        });
    }
    onCoEditorLeft(sessionId, collaboratorsItem) {
        // Debug sessions will trigger this when debugging ends. Ignore them.
        if (!session_1.SessionContext.collaboratorManager.wasCoEditor(sessionId)) {
            return;
        }
        // If we now have 0 collaborators, we need to dispose the command of the status bar item. Otherwise, we just
        // need to update the text to show the new number of collaborators.
        const textOnly = session_1.SessionContext.collaboratorManager.getCollaboratorCount() > 0;
        return this.innerUpdateCollabStatusBarItem(collaboratorsItem, textOnly);
    }
    innerUpdateCollabStatusBarItem(collaboratorsItem, textOnly) {
        return __awaiter(this, void 0, void 0, function* () {
            // Only update our collab status if we're acutally joined, or shared
            // -- other states won't have the collaborator information.
            const state = session_1.SessionContext.State;
            if (state !== session_1.SessionState.Joined && state !== session_1.SessionState.Shared) {
                return;
            }
            const collaboratorCount = session_1.SessionContext.collaboratorManager.getCollaboratorCount();
            collaboratorsItem.text = `$(organization) ${collaboratorCount}`;
            if (collaboratorCount > 0) {
                const collabIds = session_1.SessionContext.collaboratorManager.getCollaboratorSessionIds();
                if (collaboratorCount === 1) {
                    const collabId = collabIds[0];
                    const collabName = session_1.SessionContext.collaboratorManager.getDisplayName(collabId);
                    const fileName = session_1.SessionContext.coeditingClient.lastKnownFileForClient(collabId);
                    collaboratorsItem.tooltip = fileName ?
                        `Follow ${collabName} (currently editing ${fileName})` :
                        `${collabName} (not currently editing a shared document)`;
                }
                else {
                    collaboratorsItem.tooltip = 'Follow a participant\'s cursor.';
                }
                if (!textOnly) {
                    collaboratorsItem.command = commands_1.Commands.listParticipantsCommandId;
                }
            }
            else {
                collaboratorsItem.command = null;
                collaboratorsItem.tooltip = 'There are no participants (to invite others, start by clicking on your name in the status bar)';
            }
            collaboratorsItem.show();
        });
    }
}
exports.CollaborationState = CollaborationState;
/**
 * Defines the status bar behavior when the user shared their workspace.
 */
class SharedState extends CollaborationState {
    constructor() {
        super();
        this.sharingQuickPickItems = [
            {
                label: '$(clippy) Invite Others (Copy Link)',
                description: '',
                detail: 'Copy the invitation link so you can send it to other participants.',
                command: 'liveshare.start',
                enabled: () => true
            },
            {
                label: '$(megaphone) Focus Participants',
                description: '',
                detail: 'Request other participants to follow you.',
                command: 'liveshare.focusParticipants',
                enabled: () => session_1.SessionContext.SupportSummonParticipants && session_1.SessionContext.collaboratorManager.getCollaboratorCount() > 0
            },
            {
                label: '$(terminal) Share Terminal',
                description: '',
                detail: 'Start a new terminal / command prompt for use by all participants.',
                command: 'liveshare.shareTerminal',
                commandArg: portForwardingTelemetry_1.EventOrigin.StatusBar,
                enabled: () => session_1.SessionContext.SupportSharedTerminals
            },
            {
                label: '$(plug) Share Server',
                description: '',
                detail: 'Expose a local TCP port to all participants.',
                command: 'liveshare.shareServer',
                commandArg: portForwardingTelemetry_1.EventOrigin.StatusBar,
                enabled: () => true
            },
            {
                label: '$(plug) Show Shared Servers',
                description: '',
                detail: 'Show local TCP servers shared with collaboration participants.',
                command: 'liveshare.listSharedServers',
                commandArg: portForwardingTelemetry_1.EventOrigin.StatusBar,
                enabled: () => session_1.SessionContext.ServersShared
            },
            {
                label: '$(plug) Stop Sharing Server',
                description: '',
                detail: 'Stop sharing a local TCP port for all participants.',
                command: 'liveshare.unshareServer',
                commandArg: portForwardingTelemetry_1.EventOrigin.StatusBar,
                enabled: () => session_1.SessionContext.ServersShared
            },
            {
                label: '$(circle-slash) End Collaboration Session',
                description: '',
                detail: 'End collaboration session, stop sharing all content, and remove all participant access.',
                command: 'liveshare.end',
                enabled: () => true
            },
        ];
    }
    updateUserStatusBarItem(currentUserItem) {
        return __awaiter(this, void 0, void 0, function* () {
            const commandId = '_liveshare.showSharedUserOptions';
            yield util_1.ExtensionUtil.tryRegisterCommand('_liveshare.showSharedUserOptions', () => {
                return this.showQuickPick(this.sharingQuickPickItems, { placeHolder: 'What would you like to do with other collaborators?' })
                    .then(pick => pick && vscode.commands.executeCommand(pick.command, pick.commandArg));
            });
            currentUserItem.text = `$(broadcast) ${this.signedInName}`;
            currentUserItem.command = commandId;
            currentUserItem.tooltip = `Sharing via ${config.get(config.Key.name)}${this.signedInInfo}`;
            currentUserItem.show();
        });
    }
}
exports.SharedState = SharedState;
/**
 * Defines the status bar behavior when the expert joined the workspace.
 */
class JoinedState extends CollaborationState {
    constructor(commandEnabledCallback) {
        super();
        this.commandEnabledCallback = commandEnabledCallback;
        this.collaboratorQuickPickItems = [
            {
                label: '$(megaphone) Focus Participants',
                description: '',
                detail: 'Request other participants to follow you.',
                command: 'liveshare.focusParticipants',
                enabled: () => session_1.SessionContext.SupportSummonParticipants && session_1.SessionContext.collaboratorManager.getCollaboratorCount() > 0
            },
            {
                label: '$(bug) Attach to a Shared Debugging Session',
                description: '',
                detail: 'Attach your debugger to a debug session that the owner has shared with participants.',
                command: 'liveshare.debug',
                enabled: () => this.commandEnabledCallback('liveshare.debug')
            },
            {
                label: '$(terminal) Access Shared Terminal',
                description: '',
                detail: 'Open terminal that the owner has shared with participants.',
                command: 'liveshare.listSharedTerminals',
                commandArg: portForwardingTelemetry_1.EventOrigin.StatusBar,
                enabled: () => session_1.SessionContext.HasSharedTerminals
            },
            {
                label: '$(plug) Access Shared Server',
                description: '',
                detail: 'Copy a named, shared TCP port for use',
                command: 'liveshare.listSharedServers',
                commandArg: portForwardingTelemetry_1.EventOrigin.StatusBar,
                enabled: () => session_1.SessionContext.ServersShared
            },
            {
                label: '$(circle-slash) Leave Collaboration Session',
                description: '',
                detail: 'Stop participating in this collaboration session.',
                command: 'liveshare.leave',
                enabled: () => true
            },
        ];
    }
    updateUserStatusBarItem(currentUserItem) {
        return __awaiter(this, void 0, void 0, function* () {
            const commandId = '_liveshare.showCollaboratorOptions';
            yield util_1.ExtensionUtil.tryRegisterCommand('_liveshare.showCollaboratorOptions', () => {
                return this.showQuickPick(this.collaboratorQuickPickItems, { placeHolder: 'What would you like to do with other collaborators?' })
                    .then(pick => pick && vscode.commands.executeCommand(pick.command, pick.commandArg));
            });
            currentUserItem.text = `$(broadcast) ${this.signedInName}`;
            currentUserItem.command = commandId;
            currentUserItem.tooltip = `Collaborating via ${config.get(config.Key.name)}${this.signedInInfo}`;
            currentUserItem.show();
        });
    }
}
exports.JoinedState = JoinedState;

//# sourceMappingURL=statusbar.js.map
