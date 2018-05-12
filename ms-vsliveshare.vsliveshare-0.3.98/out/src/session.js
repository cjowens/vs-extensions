//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const events_1 = require("events");
const client_1 = require("./coediting/client");
const collaborators_1 = require("./workspace/collaborators");
const telemetry_1 = require("./telemetry/telemetry");
const util_1 = require("./util");
const commands_1 = require("./commands");
var SessionState;
(function (SessionState) {
    SessionState[SessionState["Initializing"] = 0] = "Initializing";
    SessionState[SessionState["SignedOut"] = 1] = "SignedOut";
    SessionState[SessionState["SigningIn"] = 2] = "SigningIn";
    SessionState[SessionState["ExternallySigningIn"] = 3] = "ExternallySigningIn";
    SessionState[SessionState["SignedIn"] = 4] = "SignedIn";
    SessionState[SessionState["SharingInProgress"] = 5] = "SharingInProgress";
    SessionState[SessionState["Shared"] = 6] = "Shared";
    SessionState[SessionState["JoiningInProgress"] = 7] = "JoiningInProgress";
    SessionState[SessionState["Joined"] = 8] = "Joined";
})(SessionState = exports.SessionState || (exports.SessionState = {}));
var SessionAction;
(function (SessionAction) {
    SessionAction[SessionAction["AttemptSharing"] = 0] = "AttemptSharing";
    SessionAction[SessionAction["SharingError"] = 1] = "SharingError";
    SessionAction[SessionAction["SharingSuccess"] = 2] = "SharingSuccess";
    SessionAction[SessionAction["EndSharing"] = 3] = "EndSharing";
    SessionAction[SessionAction["Unjoin"] = 4] = "Unjoin";
    SessionAction[SessionAction["AttemptJoining"] = 5] = "AttemptJoining";
    SessionAction[SessionAction["JoiningError"] = 6] = "JoiningError";
    SessionAction[SessionAction["JoiningPendingReload"] = 7] = "JoiningPendingReload";
    SessionAction[SessionAction["JoiningSuccess"] = 8] = "JoiningSuccess";
    SessionAction[SessionAction["AttemptSignIn"] = 9] = "AttemptSignIn";
    SessionAction[SessionAction["AwaitExternalSignIn"] = 10] = "AwaitExternalSignIn";
    SessionAction[SessionAction["SignInError"] = 11] = "SignInError";
    SessionAction[SessionAction["SignInSuccess"] = 12] = "SignInSuccess";
    SessionAction[SessionAction["SignOut"] = 13] = "SignOut";
})(SessionAction = exports.SessionAction || (exports.SessionAction = {}));
// Description of the transitions of a FSM for a session
// TODO: refactor as a statechart
exports.sessionMachine = {
    [SessionState.Initializing]: {
        [SessionAction.AttemptSignIn]: SessionState.SigningIn,
        [SessionAction.SignOut]: SessionState.SignedOut
    },
    [SessionState.ExternallySigningIn]: {
        [SessionAction.AwaitExternalSignIn]: SessionState.ExternallySigningIn,
        [SessionAction.AttemptSignIn]: SessionState.SigningIn,
        [SessionAction.SignInSuccess]: SessionState.SignedIn,
        [SessionAction.SignInError]: SessionState.SignedOut,
        [SessionAction.SignOut]: SessionState.SignedOut
    },
    [SessionState.SigningIn]: {
        [SessionAction.AwaitExternalSignIn]: SessionState.ExternallySigningIn,
        [SessionAction.SignInSuccess]: SessionState.SignedIn,
        [SessionAction.SignInError]: SessionState.SignedOut,
        [SessionAction.SignOut]: SessionState.SignedOut
    },
    [SessionState.SignedIn]: {
        [SessionAction.AttemptSharing]: SessionState.SharingInProgress,
        [SessionAction.AttemptJoining]: SessionState.JoiningInProgress,
        [SessionAction.SignOut]: SessionState.SignedOut
    },
    [SessionState.SignedOut]: {
        [SessionAction.AttemptSignIn]: SessionState.SigningIn,
        [SessionAction.AwaitExternalSignIn]: SessionState.ExternallySigningIn
    },
    [SessionState.SharingInProgress]: {
        [SessionAction.SharingError]: SessionState.SignedIn,
        [SessionAction.SharingSuccess]: SessionState.Shared,
        [SessionAction.SignOut]: SessionState.SignedOut
    },
    [SessionState.Shared]: {
        [SessionAction.EndSharing]: SessionState.SignedIn,
        [SessionAction.SignOut]: SessionState.SignedOut
    },
    [SessionState.JoiningInProgress]: {
        [SessionAction.JoiningError]: SessionState.SignedIn,
        [SessionAction.JoiningPendingReload]: SessionState.SignedIn,
        [SessionAction.JoiningSuccess]: SessionState.Joined,
        [SessionAction.SignOut]: SessionState.SignedOut
    },
    [SessionState.Joined]: {
        [SessionAction.Unjoin]: SessionState.SignedIn,
        [SessionAction.SignOut]: SessionState.SignedOut
    }
};
var SessionEvents;
(function (SessionEvents) {
    SessionEvents["StateChanged"] = "StateChanged";
})(SessionEvents = exports.SessionEvents || (exports.SessionEvents = {}));
class SessionContext extends events_1.EventEmitter {
    constructor() {
        super();
        this.currentState = SessionState.Initializing; // initial state
        // For telemetry
        // The maximum number of guests this conversation had at a time
        this.guestCountByIDE = {};
        this.distinctGuestCountByIDE = {};
        this.addListener(SessionEvents.StateChanged, this.updateTelemetryContext);
    }
    get State() {
        return SessionContext.Instance.currentState;
    }
    transition(action) {
        const currentStateConfig = exports.sessionMachine[this.State];
        if (currentStateConfig) {
            const nextState = currentStateConfig[action];
            if (nextState !== undefined) {
                // Record & send transition telemetry
                this.sendTransitionTelemetry(nextState, action);
                // Transition to the determined next state
                SessionContext.Instance.setState(nextState);
                return SessionContext.Instance.State;
            }
            // No transition exists for the given action
            return undefined;
        }
        // No config for the given state exists in the machine
        return undefined;
    }
    initCoEditingContext(parameters) {
        if (!this.workspaceSessionInfo) {
            throw new Error('Failed to join a collaboration session. '
                + 'The owner is offline. Ask them to start the session and rejoin.');
        }
        let initCoauthoringTelemetryEvent = telemetry_1.Instance.startTimedEvent(telemetry_1.TelemetryEventNames.INITIALIZE_COAUTHORING, true);
        initCoauthoringTelemetryEvent.addMeasure(telemetry_1.TelemetryPropertyNames.NUM_OPEN_FILES, vscode.window.visibleTextEditors.length);
        this.userInfo = parameters.userInfo;
        this.collaboratorManager = new collaborators_1.CollaboratorManager(this.workspaceSessionInfo.sessions);
        this.collaboratorManager.addListener(collaborators_1.CollaboratorManager.collaboratorsChangedEvent, () => this.emit(collaborators_1.CollaboratorManager.collaboratorsChangedEvent));
        this.collaboratorManager.addListener(collaborators_1.CollaboratorManager.collaboratorsChangedEvent, () => { this.collaboratorsChanged(); });
        this.coeditingClient = new client_1.Client({
            sourceEventService: parameters.sourceEventService,
            clientID: this.workspaceSessionInfo.sessionNumber,
            isExpert: parameters.isExpert,
            fileService: parameters.fileSystemService,
        });
        parameters.statusBarController.registerClientListeners(this.coeditingClient);
        this.coeditingClient.init();
        initCoauthoringTelemetryEvent.end(telemetry_1.TelemetryResult.Success);
    }
    collaboratorsChanged() {
        for (let ide of this.collaboratorManager.getIDEs()) {
            if (this.guestCountByIDE[ide] === undefined) {
                this.guestCountByIDE[ide] = 0;
            }
            if (this.distinctGuestCountByIDE[ide] === undefined) {
                this.distinctGuestCountByIDE[ide] = 0;
            }
            this.guestCountByIDE[ide] = Math.max(this.guestCountByIDE[ide], this.collaboratorManager.getCollaboratorCountByIDE(ide));
            this.distinctGuestCountByIDE[ide] = Math.max(this.distinctGuestCountByIDE[ide], this.collaboratorManager.getDistinctCollaboratorCountByIDE(ide));
        }
    }
    disposeCoEditingContext() {
        this.workspaceSessionInfo = null;
        // Null checks in case there was an error while joining / sharing and the initialization did not fully complete
        if (this.collaboratorManager) {
            this.collaboratorManager.dispose();
            this.collaboratorManager = null;
        }
        if (this.coeditingClient) {
            this.coeditingClient.dispose();
            this.coeditingClient = null;
        }
    }
    setState(newState) {
        const previousState = SessionContext.Instance.currentState;
        SessionContext.Instance.currentState = newState;
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.stateCommandContext, SessionState[newState]);
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.isCollaboratingCommandContext, newState === SessionState.Shared || newState === SessionState.Joined);
        // Disposal needs to happen synchronously, so we can't use the StateChanged event
        if (newState !== SessionState.Joined && newState !== SessionState.Shared) {
            this.disposeCoEditingContext();
        }
        SessionContext.Instance.emit(SessionEvents.StateChanged, newState, previousState);
    }
    get ServersShared() {
        return SessionContext.Instance.serversShared;
    }
    set ServersShared(serversShared) {
        SessionContext.Instance.serversShared = serversShared;
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.isServerSharedCommandContext, serversShared);
    }
    get HasSharedTerminals() {
        return SessionContext.Instance.hasSharedTerminals;
    }
    set HasSharedTerminals(hasSharedTerminals) {
        SessionContext.Instance.hasSharedTerminals = hasSharedTerminals;
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.hasSharedTerminalsCommandContext, hasSharedTerminals);
    }
    get SupportSharedTerminals() {
        return SessionContext.Instance.supportSharedTerminals;
    }
    set SupportSharedTerminals(supportSharedTerminals) {
        SessionContext.Instance.supportSharedTerminals = supportSharedTerminals;
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.supportSharedTerminalsCommandContext, supportSharedTerminals);
    }
    get SupportSummonParticipants() {
        return SessionContext.Instance.supportSummonParticipants;
    }
    set SupportSummonParticipants(supportSummonParticipants) {
        SessionContext.Instance.supportSummonParticipants = supportSummonParticipants;
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.supportSummonParticipantsCommandContext, supportSummonParticipants);
    }
    get EnableVerticalScrolling() {
        return SessionContext.Instance.enableVerticalScrolling;
    }
    set EnableVerticalScrolling(enableVerticalScrolling) {
        SessionContext.Instance.enableVerticalScrolling = enableVerticalScrolling;
    }
    get IsSignedIn() {
        return SessionContext.Instance.IsCollaborating
            || [SessionState.SignedIn,
                SessionState.SharingInProgress,
                SessionState.JoiningInProgress].indexOf(SessionContext.Instance.State) >= 0;
    }
    get IsCollaborating() {
        return [SessionState.Shared,
            SessionState.Joined].indexOf(SessionContext.Instance.State) >= 0;
    }
    get IsStartingCollaboration() {
        return [SessionState.JoiningInProgress,
            SessionState.SharingInProgress].indexOf(SessionContext.Instance.State) >= 0;
    }
    static get Instance() {
        if (!SessionContext.singleton) {
            SessionContext.singleton = new SessionContext();
        }
        return SessionContext.singleton;
    }
    sendTransitionTelemetry(nextState, fromAction) {
        telemetry_1.Instance.sendTransition(SessionState[SessionContext.Instance.State], SessionState[nextState], SessionAction[fromAction]);
    }
    updateTelemetryContext(newState, previousState) {
        let wasCollaborating = [SessionState.Shared, SessionState.Joined].indexOf(previousState) >= 0;
        if (SessionContext.Instance.IsCollaborating) {
            if (SessionContext.Instance.workspaceSessionInfo) {
                let isOwner = (newState === SessionState.Shared);
                telemetry_1.Instance.startSession(isOwner);
            }
        }
        else if (wasCollaborating) {
            telemetry_1.Instance.endSession(this.guestCountByIDE, this.distinctGuestCountByIDE);
        }
    }
    dispose() {
        if (SessionContext.Instance.IsCollaborating) {
            telemetry_1.Instance.endSession(this.guestCountByIDE, this.distinctGuestCountByIDE);
        }
    }
}
const sessionContextInstance = SessionContext.Instance;
exports.SessionContext = sessionContextInstance;

//# sourceMappingURL=session.js.map
