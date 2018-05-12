"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const wt = require("./contract/WorkspaceServiceTypes");
const util_1 = require("../util");
const session_1 = require("../session");
const events = require("events");
const commands_1 = require("../commands");
class CollaboratorManager extends events.EventEmitter {
    constructor(collaboratorProfiles) {
        super();
        this.coEditorsHistory = {}; // Hashset of all session numbers that were co-editors
        this.coEditors = {}; // Hashset of session numbers that are co-editors and currently connected
        this.coEditorsIDE = {}; // Hashset of session numbers and the IDE of these sessions
        this.coEditorCount = 0;
        this.profiles = {};
        this.localUserInfo = session_1.SessionContext.userInfo;
        this.profiles = collaboratorProfiles || {};
    }
    onWorkspaceSessionChanged(e) {
        if (e.changeType === wt.WorkspaceSessionChangeType.Joined) {
            this.profiles[e.sessionNumber] = e.userProfile;
            this.coEditorsIDE[e.sessionNumber] = e.applicationName;
        }
        else if (e.changeType === wt.WorkspaceSessionChangeType.Unjoined) {
            delete this.coEditors[e.sessionNumber];
            delete this.profiles[e.sessionNumber];
            if (this.coEditorCount > 0) {
                --this.coEditorCount;
            }
        }
        if (this.coEditorCount <= 0) {
            util_1.ExtensionUtil.setCommandContext(commands_1.Commands.hasCollaboratorsCommandContext, false);
        }
        this.emit(CollaboratorManager.collaboratorsChangedEvent);
    }
    getDisplayName(sessionId) {
        const profile = this.profiles[sessionId];
        if (profile) {
            return profile.name || profile.email;
        }
        if (session_1.SessionContext.coeditingClient && sessionId === session_1.SessionContext.coeditingClient.clientID) {
            return this.localUserInfo.displayName || this.localUserInfo.emailAddress;
        }
        // Unknown user profile. Return default value.
        return `Collaborator ${sessionId}`;
    }
    getEmail(sessionId) {
        const profile = this.profiles[sessionId];
        if (profile) {
            return profile.email || '';
        }
    }
    /**
     * Returns all IDEs used by participants in this session
     */
    getIDEs() {
        return new Set(this.getCollaboratorSessionIds().map(sessionId => this.coEditorsIDE[sessionId]));
    }
    /**
     * Returns the number of remote collaborators in this session (excludes the local user).
     */
    getCollaboratorCount() {
        return this.coEditorCount;
    }
    getCollaboratorCountByIDE(ide) {
        return this.getCollaboratorEmailsByIDE(ide).length;
    }
    /**
     * Returns the number of distinct remote collaborators in this session (excludes the local user).
     */
    getDistinctCollaboratorCount() {
        return (new Set(this.getCollaboratorEmails())).size;
    }
    getDistinctCollaboratorCountByIDE(ide) {
        return (new Set(this.getCollaboratorEmailsByIDE(ide))).size;
    }
    /**
     * Returns the sessionId of all remote collaborators (excludes the local user).
     */
    getCollaboratorSessionIds() {
        return Object.keys(this.coEditors)
            .map((id) => parseInt(id, 10));
    }
    /**
     * Returns the display names of all remote collaborators (excludes the local user).
     */
    getCollaboratorEmails() {
        return this.getCollaboratorSessionIds().map(sessionId => this.getEmail(sessionId));
    }
    getCollaboratorEmailsByIDE(ide) {
        return this.getCollaboratorSessionIds().filter(sessionId => (this.coEditorsIDE[sessionId] === ide)).map(sessionId => this.getEmail(sessionId));
    }
    coEditorsJoined(joinerIds) {
        joinerIds.forEach((joinerId) => {
            if (joinerId !== session_1.SessionContext.coeditingClient.clientID) {
                this.coEditorsHistory[joinerId] = true;
                this.coEditors[joinerId] = true;
                ++this.coEditorCount;
            }
        });
        if (this.coEditorCount > 0) {
            util_1.ExtensionUtil.setCommandContext(commands_1.Commands.hasCollaboratorsCommandContext, true);
        }
        this.emit(CollaboratorManager.collaboratorsChangedEvent);
    }
    wasCoEditor(sessionNumber) {
        return typeof this.coEditorsHistory[sessionNumber] !== 'undefined';
    }
    dispose() {
        this.removeAllListeners();
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.hasCollaboratorsCommandContext, false);
    }
}
CollaboratorManager.collaboratorsChangedEvent = 'collaboratorsChanged';
exports.CollaboratorManager = CollaboratorManager;

//# sourceMappingURL=collaborators.js.map
