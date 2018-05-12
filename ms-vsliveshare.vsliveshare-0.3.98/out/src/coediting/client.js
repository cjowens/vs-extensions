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
const vscode = require("vscode");
const traceSource_1 = require("../tracing/traceSource");
const coauthoring = require("./../workspace/contract/coauthoringServiceTypes");
const WorkspaceServiceTypes_1 = require("./../workspace/contract/WorkspaceServiceTypes");
const coauthoringService_1 = require("./common/coauthoringService");
const pathConverter_1 = require("../workspace/pathConverter");
const fm = require("../workspace/contract/FileServiceTypes");
const events_1 = require("events");
const vscodeBufferManager_1 = require("./client/vscodeBufferManager");
const util_1 = require("../util");
const decorators_1 = require("./client/decorators");
const config = require("../config");
const positionTracker_1 = require("./client/positionTracker");
const session_1 = require("../session");
const collabBuffer_1 = require("./common/collabBuffer");
const commands_1 = require("../commands");
const coauthoringTelemetry_1 = require("../telemetry/coauthoringTelemetry");
const extension_1 = require("../extension");
const semaphore_async_await_1 = require("semaphore-async-await");
const fs = require("fs");
const telemetry_1 = require("../telemetry/telemetry");
const formatPath = traceSource_1.TraceFormat.formatPath;
const maximumViewColumns = 3;
const initialSelectionNotificationDelay = 500;
function getEditorId(editor) {
    // The only way to accurately compare text editors when they move across viewcolumns is through their internal
    // "id" property. This is potentially dangerous, as internal properties may change (they are not officially part of
    // the VS Code API).
    return editor.id;
}
// This is a helper implementation of undoing the buffer until it reaches desired
// buffer content. Of note, this is based on the assumption that the remote edits
// are actually creating a 'undo stop' in the Code undo stack. A the time of
// authoring, this was true -- by observation & code inspection.
// Also, of note, that if the window looses focus, and there is no focused
// editor when this happens, nothing changes, and we'll keep calling the undo
// command. There is no indication that is did or didn't perform an operation,
// so this is very much a hope that something happens.
// Additionally, of note, VS Code's undo implementation is pretty much fire-and
// -forget; it does it irrespective of anything to undo.
function stepUndoTillContentMatches(checkpoint, doc, onComplete) {
    return new Promise((resolve, reject) => {
        vscode.commands.executeCommand('default:undo').then(() => {
            let documentContent = doc.getText();
            if (documentContent !== checkpoint) {
                setImmediate(() => {
                    stepUndoTillContentMatches(checkpoint, doc, onComplete || resolve);
                });
                return;
            }
            if (onComplete) {
                onComplete();
            }
            else {
                resolve();
            }
        });
    });
}
// Given a set of file change events, determines if they might represent a rename
// and returns the old & new file names if it is something that resembles a rename
function getFileNamesFromRenameFileChange(changes) {
    if (!changes || changes.length !== 2) {
        return;
    }
    let oldName;
    let newName;
    changes.forEach((change) => {
        switch (change.changeType) {
            case fm.FileChangeType.Added:
                newName = change.path;
                break;
            case fm.FileChangeType.Deleted:
                oldName = change.path;
                break;
            default:
                break;
        }
    });
    if (!oldName || !newName) {
        return null;
    }
    return { oldName: oldName, newName: newName };
}
class Client {
    constructor(parameters) {
        // Events
        this.coEditorsJoinedEventName = 'coEditorSwitchedFile';
        this.coEditorsJoinedEvent = new events_1.EventEmitter();
        // Lifecycle
        this.vscodeEventSubscriptions = [];
        this.isDisposed = false;
        this.sharedFileClients = {}; // Maps a lowercase file name to its file client
        this.pendingRenames = [];
        this.highestReceivedEventId = -1;
        this.highestSendId = {}; // Maps a client ID to the highest message ID we have received from them
        this.messageProcessQueue = Promise.resolve();
        this.unprocessedMessages = {};
        this.isExpert = false;
        // Language service
        this.serverVersion = -1;
        this.highestLocalTextChange = -1;
        this.textChangeEventHistory = [];
        this.textChangeEventHistoryMaxSize = 1000;
        this.unacknowledgedTextChangeIds = {};
        // Co-editor tracking
        this.clientDecoratorManagers = {};
        this.positionTracker = new positionTracker_1.PositionTracker();
        // For each of the 3 vscode.ViewColumn, keeps information on participant
        // pinning. Viewcolumns are 1-based in VS Code, so use length 4 and ignore
        // the first element.
        this.viewColumnsPinMap = new Array(maximumViewColumns + 1);
        // Action tracking
        this.joiningInitialFiles = {}; // Hashset of file names that need to be opened as part of the initial join
        this.pendingFileHandshakeCallbacks = {}; // Maps a file name to a callback that should be invoked when we receive a fileOpenAcknowledge for that file
        this.pendingFileSync = {}; // Maps a file name to its synchronized string content after the late join protocol has completed
        this.savingFiles = {}; // Hashset of file names that are being saved due to a remote save message. Needed to prevent re-sending a saveFile message when VS Code raises the documentSaved event.
        this.fileSaveRequestsPaused = false; // Flag to enable us to drop save requests when leaving a session
        // Telemetry
        this.jumpCount = 0;
        this.failedJumpCount = 0;
        this.pinCount = 0;
        this.unpinCount = 0;
        this.autoUnpinCount = 0;
        this.initialPinIdToOwner = -1;
        this.isExpert = parameters.isExpert;
        this.sourceEventService = parameters.sourceEventService;
        this.clientID = parameters.clientID;
        this.fileService = parameters.fileService;
        this.pathConverter = this.isExpert ? new pathConverter_1.ExpertPathConverter() : new pathConverter_1.OwnerPathConverter();
        const nameTagSetting = config.get(config.Key.nameTagVisibility);
        const nameTagSettingValue = decorators_1.NameTagVisibility[nameTagSetting];
        this.nameTagVisibility = nameTagSettingValue || decorators_1.NameTagVisibility.Activity;
        this.coEditingTrace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientCoEditing);
        this.vsCodeEventTrace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientCoEditingVSCodeEvent);
        this.bufferManagerTrace = traceSource_1.traceSource.withName(traceSource_1.TraceSources.ClientCoEditingBufferManager);
        this.summonsSemaphore = new semaphore_async_await_1.default(1);
        this.coEditingTrace.info(`Name tag behavior: ${this.nameTagVisibility}`);
        // Create initial mapping of columns to editors for all open editors 
        this._updateTextEditorColumnInformationFromTextEditorSet(vscode.window.visibleTextEditors);
        // Collect & process actual edits to a document to communicate those
        // changes to the other partcipents, and maintain our own state for
        // those joining later
        this.vscodeEventSubscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => this._onDidChangeTextDocument(e)));
        // Track the selection changes in a document (E.g. highlights, cursor
        // position) and communicate them to all clients so they can display
        // indicators to the other participent positions in the documents
        this.vscodeEventSubscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => this._onDidChangeTextEditorSelection(e)));
        // Understand which documents are open, split (different columns),
        // closed, and other changes. (E.g editor configuration/layout changes)
        this.vscodeEventSubscriptions.push(vscode.window.onDidChangeVisibleTextEditors((e) => this._onDidChangeVisibleTextEditors(e)));
        // Handle the changes of the currently active editor -- this is important
        // because not all editors are really considered "editors". E.g the
        // terminal window isn't really an editor. In these cases we need to
        // update states. It's also important because that is where we're doing
        // the updates of people following us / breaking follow when you change
        // your active editor when following someone.
        this.vscodeEventSubscriptions.push(vscode.window.onDidChangeActiveTextEditor((e) => this._onDidChangeActiveTextEditor(e)));
        // When closing a document, we need to clean up state/buffers for our undo
        // management (document could be reopened, which would be new undo state)
        // as well as when a document is deleted, or renamed, where we need to
        // re-wriring of the state.
        this.vscodeEventSubscriptions.push(vscode.workspace.onDidCloseTextDocument((e) => this.onDidCloseTextDocument(e)));
        // Saves need to be propagated through the session, so other clients can
        // also save when indicated (guests aren't really saving, for example)
        this.vscodeEventSubscriptions.push(vscode.workspace.onDidSaveTextDocument((e) => this._onDidSaveTextDocument(e)));
        // Scrolling API is stable and available from vscode version 1.22.2, check if it exists to not break earlier versions of vscode.
        if (typeof vscode.window.onDidChangeTextEditorVisibleRanges === 'function') {
            // Tracks scrolling event on the text document.
            this.vscodeEventSubscriptions.push(vscode.window.onDidChangeTextEditorVisibleRanges((e) => this._onDidChangeTextEditorVisibleRanges(e)));
        }
        // Listens for when the co-editors have switches files so we can update
        // our column-editor maps
        this.onCoEditorSwitchedFile((sessionId, newFileName) => this.handleCoeditorSwitchedFile(sessionId, newFileName));
    }
    get isOwner() {
        return !this.isExpert;
    }
    init() {
        // Now start listening for co-editing events that convey all the changes
        // from other clients, that are related to co-editing.
        this.sourceEventService.onEvent((eventData) => {
            this.messageProcessQueue = this.messageProcessQueue
                .then(() => this._onMessage(eventData))
                .catch((e) => {
                const errorMsg = 'Rejected promise while processing a coauthoring message';
                this.coEditingTrace.error(`${errorMsg}:\n${e.message}`);
                coauthoringTelemetry_1.CoauthoringTelemetry.ReportCoeditingError(errorMsg, e);
            });
        });
        this.fileService.onFilesChanged((e) => this.fileServiceFilesChanged(e));
        if (this.isExpert) {
            this.joiningInitialFiles = {};
            const jrMessage = coauthoringService_1.MessageFactory.JoinRequestMessage(this.clientID);
            this.postMessage(jrMessage);
        }
        this.shareActiveDocumentIfNotTheExpert();
        this.updatePinIconFromActiveEditor();
        this._listenForUserInitiatedUndoRedo();
    }
    resetLanguageServicesDataStructures() {
        this.textChangeEventHistory = [];
        this.unacknowledgedTextChangeIds = {};
    }
    get currentServerVersion() {
        return this.serverVersion;
    }
    get currentHighestLocalTextChange() {
        return this.highestLocalTextChange;
    }
    get textChangeHistory() {
        return this.textChangeEventHistory;
    }
    get hasUnacknowledgedTextChanges() {
        this.removeOldUnacknowledgedTextChanges();
        return (Object.keys(this.unacknowledgedTextChangeIds).length !== 0);
    }
    removeOldUnacknowledgedTextChanges() {
        const now = (new Date()).getTime();
        for (const sendId in this.unacknowledgedTextChangeIds) {
            if ((now - this.unacknowledgedTextChangeIds[sendId]) > 5000) {
                delete this.unacknowledgedTextChangeIds[sendId];
                telemetry_1.Instance.sendFault(coauthoringTelemetry_1.Event.DROPPED_HOST_MESSAGE_FAULT, telemetry_1.FaultType.NonBlockingFault, 'Did not receive acknowledgement of host message');
            }
        }
    }
    postMessage(message) {
        if (this.isDisposed) {
            return;
        }
        message.sendId = Client.sendId++;
        if (message.messageType === coauthoring.MessageType.TextChange) {
            this.highestLocalTextChange = message.sendId;
            this.unacknowledgedTextChangeIds[message.sendId] = (new Date()).getTime();
        }
        this.sourceEventService.fireEventAsync(coauthoringService_1.CoauthoringService.SERVICE, JSON.stringify(message));
    }
    dispose() {
        this.isDisposed = true;
        this.sourceEventService.removeAllListeners();
        if (this.clientDecoratorManagers) {
            Object.keys(this.clientDecoratorManagers).forEach((cId) => {
                this.clientDecoratorManagers[cId].dispose();
            });
        }
        this.coEditorsJoinedEvent.removeAllListeners();
        this.vscodeEventSubscriptions.forEach((d) => {
            d.dispose();
        });
        this.positionTracker.dispose();
        this.updatePinableCommandStatus(false);
        this.setPinned(false);
        // Close summon states
        this.summoningParticipants = null;
        // Send telemetry
        coauthoringTelemetry_1.CoauthoringTelemetry.SessionClosed(this.jumpCount, this.failedJumpCount, this.pinCount, this.unpinCount, this.autoUnpinCount);
        Object.keys(this.sharedFileClients).forEach((fileName) => {
            this.sharedFileClients[fileName].dispose();
        });
    }
    _listenForUserInitiatedUndoRedo() {
        if (!config.featureFlags.localUndo) {
            return;
        }
        this.vscodeEventSubscriptions.push(util_1.ExtensionUtil.registerCommand('undo', this.performUserInitiatedUndo, this));
        this.vscodeEventSubscriptions.push(util_1.ExtensionUtil.registerCommand('redo', this.performUserInitiatedRedo, this));
    }
    _onDidChangeTextDocument(e) {
        if (e.contentChanges.length === 0) {
            // VSCode indicates that the dirty state changed by sending
            // this no-changes event. Since we don't care about the
            // dirty state via this notification, drop them on the floor.
            this.vsCodeEventTrace.verbose('onDidChangeTextDocument: Document dirty state changes');
            return;
        }
        const fileName = this.pathConverter.uriToFileName(e.document.uri);
        if (fileName === null) {
            // This is likely a document we're not tracking or can't
            // handle, so don't try to handle this event.
            return;
        }
        this.vsCodeEventTrace.verbose(`onDidChangeTextDocument: (${formatPath(fileName)})`);
        // Get the client for this file -- this is where we hand off the actual
        // document changes to be handled on a per-file basis, and broadcast to
        const fileClient = this.getSharedFileClient(fileName);
        if (!fileClient) {
            this.coEditingTrace.warning(`Edited a shared document that did not have a file client opened (${formatPath(fileName)})`);
            return;
        }
        fileClient.onDidChangeTextDocument(e);
        this.positionTracker.onDidChangeTextDocument(fileName, e);
        // If this change appears to have been made by the local user, unpin the viewcolumn in which the edit was made
        if (fileClient.waitingForRemoteEditsToBeApplied()) {
            // This was caused by a remote edit; don't unpin anything
            return;
        }
        const activeEditor = vscode.window.activeTextEditor;
        const changeIsInActiveEditor = activeEditor.document.uri.toString() === e.document.uri.toString();
        if (changeIsInActiveEditor) {
            this.unpinByEditor(vscode.window.activeTextEditor);
        }
    }
    _onDidChangeTextEditorVisibleRanges(e) {
        if (!e.textEditor || !e.textEditor.document) {
            return;
        }
        const fileName = this.pathConverter.uriToFileName(e.textEditor.document.uri);
        if (!fileName) {
            return;
        }
        this.vsCodeEventTrace.verbose(`onDidChangeTextEditorVisibleRanges (${formatPath(fileName)}): ${JSON.stringify(e.visibleRanges)}`);
        this.sendLayoutChangeMessage(fileName, e.visibleRanges);
    }
    _onDidChangeTextEditorSelection(e) {
        if (this.justChangedDocumentTimeout) {
            clearTimeout(this.justChangedDocumentTimeout);
            this.justChangedDocumentTimeout = null;
        }
        if (!e.textEditor || !e.textEditor.document) {
            return;
        }
        const document = e.textEditor.document;
        const fileName = this.pathConverter.uriToFileName(document.uri);
        if (fileName) {
            this.vsCodeEventTrace.verbose(`onDidChangeTextEditorSelection (${formatPath(fileName)}): ${JSON.stringify(e.selections)}`);
        }
        this.sendSelectionChangeMessage(document, e.selections);
        // If the selection change kind is anything but undefined, it means it was initiated by the local user, so
        // unpin the active editor
        if (e.kind !== undefined) {
            this.unpinByEditor(vscode.window.activeTextEditor);
        }
    }
    _onDidChangeActiveTextEditor(e) {
        // Always update our pin status
        this.updatePinIconFromActiveEditor();
        if (!e || !e.document) {
            // Implies when we have no active text editor, so theres nothing
            // for us to do
            this.updatePinableCommandStatus(false);
            return;
        }
        const document = e.document;
        const fileName = this.pathConverter.uriToFileName(document.uri);
        if (fileName === null) {
            // Not a document we care about
            return;
        }
        this.vsCodeEventTrace.info(`onDidChangeActiveTextEditor (${formatPath(fileName)})`);
        // If we have an owner ID, we should automatically pin to that owner for
        // a better start experience. We need to reset it so that the next editor
        // change doesn't for the next edtiro change
        if (this.initialPinIdToOwner !== -1) {
            this.pin(e, this.initialPinIdToOwner);
            this.initialPinIdToOwner = -1;
        }
        // Make sure that we've notified others that a new document has been
        // opened. It's expected that this does the right thing depending on
        // our state, so we don't need to handle it here.
        this.shareActiveDocumentIfNotTheExpert();
        // When opening a document for the first time, VS Code does not fire a onDidChangeTextEditorSelection event.
        // This means that collaborators will still see this user in the previous document. As workaround, force send a
        // selection change message after a brief period if VS Code did not raise the event itself.
        this.justChangedDocumentTimeout = setTimeout(() => this.sendCurrentSelectionMessage(), initialSelectionNotificationDelay);
        // Update decorators so they show in this new editor.
        Object.keys(this.clientDecoratorManagers).forEach((clientId) => {
            this.clientDecoratorManagers[clientId].updateDecorators();
        });
    }
    _onDidChangeVisibleTextEditors(visibleEditors) {
        this.vsCodeEventTrace.verbose(`onDidChangeVisibleTextEditors (new active viewcolumns: ${visibleEditors.map((editor) => editor.viewColumn).join(', ')})`);
        // VS Code quirk: Sometimes, "invisible", non-document editors with an undefined viewcolumn get inserted into
        // the event. Filter them out.
        visibleEditors = visibleEditors.filter((editor) => {
            return typeof editor.viewColumn !== 'undefined';
        });
        // VS Code quirk: when this event is raised, the editors don't yet know about their new viewcolumn, so it's
        // impossible to track exactly which editor is now in which column. To work around this, handle the event
        // asynchronously, which gives VS Code the time to update the viewcolumn properties of the visible editors.
        setTimeout(() => {
            this._updateTextEditorColumnInformationFromTextEditorSet(visibleEditors);
        }, 1);
    }
    _updateTextEditorColumnInformationFromTextEditorSet(editors) {
        // Work out how many columns of editors we previously had so we can
        // handle changes when the total columns is unchanged.
        let previousColumnCount = this.viewColumnsPinMap.filter(column => !!column).length;
        // We don't update the items in place, since it's easier to just copy
        // the data across based on the new information, espcially since items
        // might move between columns.
        const newState = new Array(this.viewColumnsPinMap.length);
        editors.forEach((editor) => {
            newState[editor.viewColumn] = {
                documentUri: editor.document.uri.toString(),
                id: getEditorId(editor),
                isChangingDocument: false,
                pinnedClient: undefined
            };
        });
        if (previousColumnCount === editors.length) {
            // Columns have remained the same, but their displayed documents have changed. If we weren't expecting
            // those changes, it means they were caused by the local user, so unpin those viewcolumns.
            for (let column = 1; column <= maximumViewColumns; ++column) {
                const viewColumnInfo = this.viewColumnsPinMap[column];
                if (!(viewColumnInfo && newState[column] && viewColumnInfo.documentUri !== newState[column].documentUri)) {
                    continue;
                }
                if (viewColumnInfo.isChangingDocument) {
                    // Change was expected; update existing tracking
                    const pinnedClient = viewColumnInfo.pinnedClient;
                    this.viewColumnsPinMap[column] = newState[column];
                    this.viewColumnsPinMap[column].pinnedClient = pinnedClient;
                }
                else {
                    // Change wasn't expected; unpin
                    this.unpinByViewColumn(column);
                }
            }
        }
        // Update our tracking info
        this.viewColumnsPinMap.forEach((viewColumnInfo) => {
            if (!viewColumnInfo || typeof viewColumnInfo.pinnedClient === 'undefined') {
                // Column wasn't pinned to a participant
                return;
            }
            const matchingNewViewColumnInfo = newState.find((newViewColumnInfo) => {
                return newViewColumnInfo && newViewColumnInfo.id === viewColumnInfo.id;
            });
            if (!matchingNewViewColumnInfo) {
                return;
            }
            // This editor is still visible, so its column was not closed. Update the new state's pinned
            // collaborator so we remain pinned in the new column.
            matchingNewViewColumnInfo.pinnedClient = viewColumnInfo.pinnedClient;
        });
        this.viewColumnsPinMap = newState;
        this.updatePinIconFromActiveEditor();
    }
    onDidCloseTextDocument(e) {
        let filename = this.pathConverter.uriToFileName(e.uri);
        let sharedClient = this.getSharedFileClient(filename);
        if (!sharedClient) {
            // We don't know about this file, so we're not going to do anything
            return;
        }
        // The document definitely closed, so the undo state is lost. So always
        // clear it, even if it were a rename.
        sharedClient.clearUndoStateDueToDocumentClosing();
        let newName = this.getNewNameFromRename(sharedClient.fileName);
        // First check to see if it's in the rename list, and what it's new name is
        if (newName) {
            this.renameSharedFileClient(sharedClient, newName);
            return;
        }
        // For non owners, we've already handled the delete in the file service
        // handler. Additionally, if the file still exists here, we don't want
        // to clean it up, since it could come back.
        if (!this.isOwner || fs.existsSync(e.fileName)) {
            return;
        }
        this.removeSharedFileClient(sharedClient);
    }
    getNewNameFromRename(filename) {
        const rename = this.pendingRenames.filter((renameInformation) => renameInformation.oldName === filename)[0];
        if (!rename) {
            return null;
        }
        // Now we've got a rename, we need to remove it from the list
        const pendingItemIndex = this.pendingRenames.indexOf(rename);
        this.pendingRenames.splice(pendingItemIndex, 1);
        return rename.newName;
    }
    _onDidSaveTextDocument(e) {
        if (!e) {
            return;
        }
        const fileName = this.pathConverter.uriToFileName(e.uri);
        if (!fileName) {
            return;
        }
        if (this.fileSaveRequestsPaused) {
            return;
        }
        this.vsCodeEventTrace.info(`onDidSaveTextDocument (${formatPath(fileName)})`);
        if (this.isOwner) {
            const sharedFile = this.getSharedFileClient(fileName);
            sharedFile.takeSnapshot();
        }
        const lowercaseFileName = fileName.toLowerCase();
        if (this.savingFiles[lowercaseFileName]) {
            // This save was initiated by a saveFile message
            delete this.savingFiles[lowercaseFileName];
            return;
        }
        // This save appears to have been initiated by the user; send a saveFile message to collaborators
        const saveFileMsg = coauthoringService_1.MessageFactory.SaveFileMessage(this.clientID, fileName);
        this.postMessage(saveFileMsg);
    }
    pauseProcessingFileSaveRequests() {
        this.fileSaveRequestsPaused = true;
    }
    resumeProcessingFileSaveRequests() {
        this.fileSaveRequestsPaused = false;
    }
    fileServiceFilesChanged(e) {
        // Assumption: Renames come in changes of Add + Delete Only
        // Assumption: If we see a delete on it's own, or in a bucket of changes
        //             larger than 2, it's just a delete.
        // Fast path changes that are one item, and "update", seen on file saves
        if (e.changes.length === 1 && e.changes[0].changeType === fm.FileChangeType.Updated) {
            return;
        }
        let renameDetails = getFileNamesFromRenameFileChange(e.changes);
        if (renameDetails) {
            // If we got extracted changes, we assume it was actually a rename
            // and add the details to the pending rename list
            this.pendingRenames.push(renameDetails);
            return;
        }
        // Find the deletes, and remove any shared clients. Documents that are
        // open will be cleaned up shortly (by VS Code), so we don't need to close
        // them ourselves.
        e.changes.forEach((change) => {
            if (change.changeType !== fm.FileChangeType.Deleted) {
                return;
            }
            let sharedClient = this.getSharedFileClient(change.path);
            if (!sharedClient) {
                return;
            }
            this.removeSharedFileClient(sharedClient);
        });
    }
    _onMessage(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isDisposed) {
                // This can happen if the user left the session before the client was done processing all queued messages.
                return;
            }
            if (msg.eventId <= this.highestReceivedEventId) {
                this.coEditingTrace.error(`Message out of order: received ${msg.eventId}, highest received is ${this.highestReceivedEventId}`);
            }
            else {
                this.highestReceivedEventId = msg.eventId;
            }
            if (msg.sourceId !== coauthoringService_1.CoauthoringService.SERVICE) {
                // Drop any messages that aren't destined for us
                return;
            }
            // JSON parsing does not add default property values, so run the deserialized message through the factory.
            let message = JSON.parse(msg.jsonContent);
            message = coauthoringService_1.MessageFactory.CoauthoringMessage(message);
            const senderId = message.clientId;
            // This block is here to update the data structures needed by language services to determine whether or not
            // requests from guests can be serviced by the host (i.e. if the two buffers agree)
            if (message.messageType === coauthoring.MessageType.TextChange) {
                let textChangeMessage = message;
                if (textChangeMessage.clientId === this.clientID) {
                    delete this.unacknowledgedTextChangeIds[textChangeMessage.sendId];
                }
                this.serverVersion = textChangeMessage.changeServerVersion;
                if (this.textChangeEventHistory.length >= this.textChangeEventHistoryMaxSize) {
                    this.textChangeEventHistory.shift();
                }
                this.textChangeEventHistory.push(textChangeMessage);
            }
            // Don't handle our own messages unless the message type requires it.
            if (senderId === this.clientID && message.messageType !== coauthoring.MessageType.TextChange) {
                return;
            }
            // Update the highwater marks to track where each client is relative to
            // the messages we've already seen from them.
            if (typeof message.sendId === 'number' && message.sendId > 0) {
                if (typeof this.highestSendId[senderId] !== 'number') {
                    this.highestSendId[senderId] = -1;
                }
                if (message.sendId <= this.highestSendId[senderId]) {
                    this.coEditingTrace.error(`Message from client #${senderId} out of order: received ${message.sendId}, highest received is ${this.highestSendId[senderId]}`);
                }
                else {
                    this.highestSendId[senderId] = message.sendId;
                }
            }
            let messageFileName = message.fileName;
            let targetFileClient = this.getSharedFileClient(messageFileName);
            // Certain types of file message require custom handling when we don't
            // have a file client for that file -- specifically, handling changes
            // and notifications we havn't really processed yet. Note, however, that
            // the FileOpen* messages don't get handled here at all.
            if (coauthoringService_1.IsFileContentMessage(message) && !targetFileClient) {
                switch (message.messageType) {
                    case coauthoring.MessageType.SelectionChange:
                        // Even if there are no file clients for this file yet, we need to remember this collaborator's
                        // position. This also causes the document to be opened invisibly, triggering the document
                        // handshake.
                        this.coEditingTrace.info(`Processing a selection change for a file client that does not exist yet (${formatPath(messageFileName)})`);
                        this.updateCoEditorPosition(message);
                        break;
                    default:
                        // Queue this message until the file client has been created (a file open acknowledge is most
                        // likely on the way)
                        this.coEditingTrace.info(`The file client does not exist yet; queuing file message for ${formatPath(messageFileName)}: ${message.messageType}`);
                        if (!this.unprocessedMessages[messageFileName]) {
                            this.unprocessedMessages[messageFileName] = [];
                        }
                        this.unprocessedMessages[messageFileName].push(new vscodeBufferManager_1.MessageAndVersionNumber(message, msg.eventId));
                        break;
                }
                // We can't process any more of these messages since theres no
                // file client to push these changes into.
                return;
            }
            switch (message.messageType) {
                case coauthoring.MessageType.TextChange:
                case coauthoring.MessageType.SelectionChange:
                    targetFileClient.onIncomingMessage(message, msg.eventId);
                    break;
                case coauthoring.MessageType.LayoutScroll:
                    if (session_1.SessionContext.EnableVerticalScrolling) {
                        for (let i = 1; i <= maximumViewColumns; ++i) {
                            const viewColumnInfo = this.viewColumnsPinMap[i];
                            if (viewColumnInfo && viewColumnInfo.pinnedClient === message.clientId) {
                                // Scroll the document, if this client is pinned to the message owner.
                                this.updateCoEditorScrollPosition(message);
                            }
                        }
                    }
                    break;
                case coauthoring.MessageType.JoinRequest:
                    this.fireCoEditorsJoined([senderId]);
                    if (!this.isOwner) {
                        break;
                    }
                    const coEditors = session_1.SessionContext.collaboratorManager.getCollaboratorSessionIds();
                    coEditors.unshift(this.clientID); // Make sure the sharer is the 1st in the list
                    // Send the list of shared documents, with the active document being first
                    const activeFileName = this.activeFileName;
                    const sharedFileNames = [];
                    Object.keys(this.sharedFileClients).forEach((lowercaseSharedFileName) => {
                        const actualFileName = this.sharedFileClients[lowercaseSharedFileName].fileName;
                        if (actualFileName === activeFileName) {
                            sharedFileNames.unshift(actualFileName);
                        }
                        else {
                            sharedFileNames.push(actualFileName);
                        }
                    });
                    this.postMessage(coauthoringService_1.MessageFactory.JoinAcknowledgeMessage(this.clientID, senderId, coEditors, sharedFileNames));
                    break;
                case coauthoring.MessageType.JoinAcknowledge:
                    const joinAcknowledgeMsg = message;
                    if (joinAcknowledgeMsg.joinerId === this.clientID) {
                        // Set the owner id, to be used for pinning after opening active document.
                        this.initialPinIdToOwner = joinAcknowledgeMsg.clientId;
                        this.fireCoEditorsJoined(joinAcknowledgeMsg.clientIds);
                        joinAcknowledgeMsg.files.forEach((openFileName) => {
                            const lowercaseOpenFileName = openFileName.toLowerCase();
                            this.joiningInitialFiles[lowercaseOpenFileName] = true;
                            this.requestOpenSharedFile(openFileName); // Do not await this; fire asynchronously so we can process the subsequent handshake messages
                        });
                    }
                    else if (this.isExpert) {
                        // Send current selection for the new joiner
                        this.sendCurrentSelectionMessage();
                    }
                    break;
                case coauthoring.MessageType.SaveFile:
                    const fileSaveMsg = message;
                    const lowercaseSaveFileName = fileSaveMsg.fileName.toLowerCase();
                    this.savingFiles[lowercaseSaveFileName] = true;
                    const targetUri = this.pathConverter.fileNameToUri(fileSaveMsg.fileName);
                    const targetDocument = yield vscode.workspace.openTextDocument(targetUri);
                    yield targetDocument.save();
                    break;
                case coauthoring.MessageType.FileOpenAcknowledge:
                    const fileOpenAcknowledgeMsg = message;
                    if (fileOpenAcknowledgeMsg.joinerId === this.clientID) {
                        const lowercaseOpenFileName = fileOpenAcknowledgeMsg.fileName.toLowerCase();
                        if (this.pendingFileHandshakeCallbacks[lowercaseOpenFileName]) {
                            this.pendingFileHandshakeCallbacks[lowercaseOpenFileName](fileOpenAcknowledgeMsg);
                        }
                        else {
                            // Got a response for a file we never requested...
                            this.coEditingTrace.warning(`Received unrequested fileOpenAcknowledge message for ${formatPath(fileOpenAcknowledgeMsg.fileName)}`);
                        }
                    }
                    else if (this.isExpert && fileOpenAcknowledgeMsg.fileName === this.activeFileName) {
                        // Someone is opening the file we are in. Send our current selection.
                        this.sendCurrentSelectionMessage();
                    }
                    break;
                case coauthoring.MessageType.FileOpenRequest:
                    const fileOpenRequestMsg = message;
                    const fileName = fileOpenRequestMsg.fileName;
                    if (this.isExpert) {
                        if (!this.getSharedFileClient(fileName)) {
                            // Someone is opening a file that isn't shared yet. Open it too.
                            this.requestOpenSharedFile(fileName); // Do not await this; fire asynchronously so we can process the subsequent handshake messages
                        }
                        break;
                    }
                    // When we don't find the document, we can't just create the file
                    // client -- we have to open the document first, since there is
                    // currently no "invisible" editor support in VS Code.
                    let fileClient = this.getSharedFileClient(fileName);
                    if (!fileClient) {
                        const document = yield vscode.workspace.openTextDocument(this.pathConverter.fileNameToUri(fileName));
                        fileClient = this.createSharedFileClient(fileName, document.getText(), document.languageId);
                    }
                    let snapshot = fileClient.getSavedSnapshotOrFallback(fileOpenRequestMsg.hashCode);
                    const bufferHistory = fileClient.getCurrentHistory();
                    const initialVersion = bufferHistory.shift(); // For the 1st history version, only the version number is needed, not the associated message.
                    const response = coauthoringService_1.MessageFactory.FileOpenAcknowledgeMessage(this.clientID, fileName, senderId, snapshot.serverVersionNumber, initialVersion.serverVersionNumber, snapshot.changes, snapshot.fallbackText, bufferHistory, /*isReadOnly*/ false);
                    this.postMessage(response);
                    // If we've been asked to send the jump to when opened, and the
                    // user is actively looking at the document, send a selection
                    // message with the sender to force a follow on the otherside
                    if (fileOpenRequestMsg.sendJumpTo && fileOpenRequestMsg.fileName === this.activeFileName) {
                        this.sendCurrentSelectionMessage(senderId);
                    }
                    break;
                case coauthoring.MessageType.Summon:
                    if (!this.summoningParticipants) {
                        this.summoningParticipants = new Set();
                    }
                    if (session_1.SessionContext.SupportSummonParticipants && !this.summoningParticipants.has(message.clientId)) {
                        this.summoningParticipants.add(message.clientId);
                        const summonsMsg = message;
                        this.RespondToSummonsAsync(summonsMsg.clientId);
                    }
                    break;
                default:
                    // Other messages not implemented yet.
                    this.coEditingTrace.warning(`Received unknown message type: ${message.messageType}`);
            }
        });
    }
    RespondToSummonsAsync(clientId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.summonsSemaphore.acquire();
            const acceptAction = 'Follow';
            const rejectAction = 'Ignore';
            let result = yield vscode.window.showInformationMessage(`${session_1.SessionContext.collaboratorManager.getDisplayName(clientId)} requested you to follow them.`, acceptAction, rejectAction);
            if (result === acceptAction) {
                this.pin(vscode.window.activeTextEditor, clientId);
            }
            this.summoningParticipants.delete(clientId);
            this.summonsSemaphore.release();
        });
    }
    getSharedFileClientFromEditor(editor) {
        if (!editor || !editor.document) {
            // Not a real editor, or document, so no file client
            return null;
        }
        const fileName = this.pathConverter.uriToFileName(editor.document.uri);
        return this.getSharedFileClient(fileName);
    }
    getSharedFileClient(fileName) {
        if (typeof fileName !== 'string') {
            return null;
        }
        const lowerCaseFileName = fileName.toLowerCase();
        return this.sharedFileClients[lowerCaseFileName] || null;
    }
    createSharedFileClient(fileName, initialContent, languageId) {
        const existingClient = this.getSharedFileClient(fileName);
        if (existingClient) {
            this.coEditingTrace.warning(`Attempted to re-create an existing file client for ${formatPath(fileName)}`);
            return existingClient;
        }
        this.coEditingTrace.info(`Creating file client for ${formatPath(fileName)}`);
        const uri = this.pathConverter.fileNameToUri(fileName);
        const lowerCaseFileName = fileName.toLowerCase();
        const newFileClient = new ClientFileData(this, fileName, uri, initialContent, this.bufferManagerTrace);
        this.sharedFileClients[lowerCaseFileName] = newFileClient;
        if (languageId) {
            newFileClient.setLanguageId(languageId);
        }
        // Newly created, so we need an initial snapshot to work from
        newFileClient.takeSnapshot();
        return newFileClient;
    }
    renameSharedFileClient(client, newName) {
        const oldNameLowerCase = client.fileName.toLowerCase();
        // Remove it from the old file name, so we don't continue to manipulate
        // or handle messages for that old filename
        delete this.sharedFileClients[oldNameLowerCase];
        // Update it's new file name on the client itself, and add it back into
        // to the map at it's new file name so that any edits will correctly apply
        // to the same document, depsite it getting a new name.
        client.updateFileName(newName);
        this.sharedFileClients[newName.toLowerCase()] = client;
    }
    removeSharedFileClient(client) {
        delete this.sharedFileClients[client.fileName.toLowerCase()];
        client.dispose();
    }
    shareActiveDocumentIfNotTheExpert() {
        if (this.isExpert) {
            return;
        }
        const activeFileName = this.activeFileName;
        if (!activeFileName || this.getSharedFileClient(activeFileName)) {
            return;
        }
        const document = vscode.window.activeTextEditor.document;
        this.createSharedFileClient(activeFileName, document.getText(), document.languageId);
        this.postMessage(coauthoringService_1.MessageFactory.FileOpenRequestMessage(this.clientID, activeFileName, 0, false));
    }
    /**
     * Opens the specified file as a VS Code document, which ends up going through the file system provider. The file
     * system provider will then call back into the client to perform the handshake protocol with the sharer ("late
     * join") for this file.
     *
     * @param fileName the name of the file to open
     */
    requestOpenSharedFile(fileName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isOwner) {
                return;
            }
            const uri = this.pathConverter.fileNameToUri(fileName);
            const document = yield vscode.workspace.openTextDocument(uri);
            // TODO: When we support edits on buffers without requiring the tab to be open, process the pending messages on
            // the invisible buffer before fully opening the document.
            const sharedFileClient = this.getSharedFileClient(fileName);
            sharedFileClient.setLanguageId(document.languageId);
            sharedFileClient.drainMessageQueue();
        });
    }
    /**
     * Sends a fileOpenRequest for the specified file, and performs synchronization of the file content after receiving
     * the acknowledge from the sharer.
     *
     * @param fileName the name of the file
     * @param receivedContent the initial content that the file service received for this file
     */
    performFileOpenHandshake(fileName, receivedContent) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isOwner) {
                return;
            }
            const lowercaseFileName = fileName.toLowerCase();
            if (this.pendingFileSync[lowercaseFileName]) {
                return this.pendingFileSync[lowercaseFileName];
            }
            const existingFileClient = this.getSharedFileClient(fileName);
            if (existingFileClient) {
                return existingFileClient.getBufferContent();
            }
            return this.pendingFileSync[lowercaseFileName] = new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                const fileOpenAcknowledgeMsg = yield new Promise((ackResolve, ackReject) => {
                    this.pendingFileHandshakeCallbacks[lowercaseFileName] = ackResolve;
                    const currentHash = util_1.calculateFileHash(receivedContent);
                    const isInitialFile = !!this.joiningInitialFiles[lowercaseFileName];
                    delete this.joiningInitialFiles[lowercaseFileName];
                    const fileOpenRequestMsg = coauthoringService_1.MessageFactory.FileOpenRequestMessage(this.clientID, fileName, currentHash, /* sendJumpTo */ isInitialFile || this.initialPinIdToOwner !== -1);
                    this.postMessage(fileOpenRequestMsg);
                });
                delete this.pendingFileHandshakeCallbacks[lowercaseFileName];
                const initialSyncContent = fileOpenAcknowledgeMsg.fallbackText ? fileOpenAcknowledgeMsg.fallbackText : receivedContent;
                const tempBuffer = new collabBuffer_1.CollabBuffer(initialSyncContent);
                // Undo unacknowledged changes that are included in the content received by the file service
                fileOpenAcknowledgeMsg.changes.forEach((edits) => {
                    tempBuffer.applyRemoteEdits(edits.map((edit) => {
                        return {
                            position: edit.start,
                            length: edit.length,
                            text: edit.newText
                        };
                    }));
                });
                // Create the file client with the resulting text and apply the initial history
                const newFileClient = this.createSharedFileClient(fileName, tempBuffer.getContent());
                newFileClient.initializeHistory(fileOpenAcknowledgeMsg);
                // Flush messages that were being held because the file client wasn't ready
                if (this.unprocessedMessages[fileName]) {
                    this.unprocessedMessages[fileName].forEach((coauthoringMsg) => {
                        newFileClient.onIncomingMessage(coauthoringMsg.message, coauthoringMsg.serverVersionNumber, vscodeBufferManager_1.CoeditingIncomingMessageBehavior.Queue);
                    });
                    delete this.unprocessedMessages[fileName];
                }
                resolve(newFileClient.getBufferContent());
                delete this.pendingFileSync[lowercaseFileName];
            }));
        });
    }
    uriToFileName(uri) {
        return this.pathConverter.uriToFileName(uri);
    }
    updateCoEditorPosition(message) {
        const clientId = message.clientId;
        if (clientId === this.clientID) {
            return;
        }
        const documentUri = this.pathConverter.fileNameToUri(message.fileName);
        vscode.workspace.openTextDocument(documentUri)
            .then((document) => {
            // Convert the selection to VS Code coordinates and update the position tracker
            const fileClient = this.getSharedFileClient(message.fileName);
            const selectionStart = fileClient.toVSCodeDocumentPos(message.start, document);
            const selectionEnd = fileClient.toVSCodeDocumentPos(message.start + message.length, document);
            const vsCodeSelectionRange = new vscode.Range(selectionStart, selectionEnd);
            this.positionTracker.setClientPosition(message.clientId, message.fileName, document, vsCodeSelectionRange, message.isReversed);
            // Update the co-editor's position indicators
            if (!this.clientDecoratorManagers[clientId]) {
                const name = session_1.SessionContext.collaboratorManager.getDisplayName(clientId);
                this.clientDecoratorManagers[clientId] = new decorators_1.ClientDecoratorManager(clientId, name, this.nameTagVisibility, this.positionTracker);
            }
            this.clientDecoratorManagers[clientId].updateDecorators();
            // Honor force jump to
            if (message.forceJumpForClientId === this.clientID) {
                this.jumpTo(clientId);
            }
            // Jump to this participant in the appropriate viewcolumn if we are pinned
            for (let i = 1; i <= maximumViewColumns; ++i) {
                const viewColumnInfo = this.viewColumnsPinMap[i];
                if (viewColumnInfo && viewColumnInfo.pinnedClient === clientId) {
                    this.jumpTo(clientId, i);
                }
            }
        });
    }
    updateCoEditorScrollPosition(message) {
        if (message.clientId === this.clientID) {
            return;
        }
        if (this.activeFileName === message.fileName) {
            const document = vscode.window.activeTextEditor.document;
            const fileClient = this.getSharedFileClient(message.fileName);
            const transformedMessage = fileClient.transformScrollSelectionToCurrent(message);
            const scrollStart = fileClient.toVSCodeDocumentPos(transformedMessage.start, document);
            const scrollEnd = fileClient.toVSCodeDocumentPos(transformedMessage.start + transformedMessage.length, document);
            const scrollRange = new vscode.Range(scrollStart, scrollEnd);
            vscode.window.activeTextEditor.revealRange(scrollRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }
    jumpTo(clientId, viewColumn, explicit = false) {
        const lastKnownPosition = this.positionTracker.getClientPosition(clientId);
        if (explicit) {
            ++this.jumpCount;
        }
        if (!lastKnownPosition) {
            // Either the collaborator is not in a shared document, or we don't know their location.
            if (explicit) {
                ++this.failedJumpCount;
                this.showJumpFailedNotification();
            }
            return;
        }
        const uri = this.pathConverter.fileNameToUri(lastKnownPosition.fileName);
        vscode.workspace.openTextDocument(uri)
            .then((document) => {
            return vscode.window.showTextDocument(document, viewColumn, true);
        })
            .then((editor) => {
            editor.revealRange(lastKnownPosition.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        });
    }
    pin(editor, clientId) {
        ++this.pinCount;
        if (!this.positionTracker.getClientPosition(clientId)) {
            ++this.failedJumpCount;
            this.showJumpFailedNotification();
            return;
        }
        this.viewColumnsPinMap[editor.viewColumn] = {
            documentUri: editor.document.uri.toString(),
            id: getEditorId(editor),
            isChangingDocument: this.positionTracker.getClientPosition(clientId).fileName !== this.fileNameForEditor(editor),
            pinnedClient: clientId
        };
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.pinnedCommandContext, true);
        this.jumpTo(clientId, editor.viewColumn);
    }
    unpinByEditor(editor, explicit = false) {
        this.unpinByViewColumn(editor.viewColumn, explicit);
    }
    unpinByViewColumn(viewColumn, explicit = false) {
        const viewColumnPinInfo = this.viewColumnsPinMap[viewColumn];
        if (!viewColumnPinInfo || typeof viewColumnPinInfo.pinnedClient === 'undefined') {
            // No op
            return;
        }
        if (explicit) {
            ++this.unpinCount;
        }
        else {
            ++this.autoUnpinCount;
        }
        delete this.viewColumnsPinMap[viewColumn].pinnedClient;
        if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.viewColumn === viewColumn) {
            util_1.ExtensionUtil.setCommandContext(commands_1.Commands.pinnedCommandContext, false);
        }
    }
    lastKnownFileForClient(clientId) {
        const lastKnownPosition = this.positionTracker.getClientPosition(clientId);
        return lastKnownPosition ? lastKnownPosition.fileName.replace(/^\/*/, '') : undefined;
    }
    onCoEditorSwitchedFile(handler) {
        this.positionTracker.onCoEditorSwitchedFile(handler);
    }
    onCoEditorsJoined(handler) {
        this.coEditorsJoinedEvent.addListener(this.coEditorsJoinedEventName, handler);
    }
    onWorkspaceSessionChanged(e) {
        return __awaiter(this, void 0, void 0, function* () {
            const sessionId = e.sessionNumber;
            // We only need to clean up state if someone leaves the session, and they
            // were a co-editor
            if (e.changeType !== WorkspaceServiceTypes_1.WorkspaceSessionChangeType.Unjoined || !session_1.SessionContext.collaboratorManager.wasCoEditor(sessionId)) {
                return;
            }
            if (this.clientDecoratorManagers[sessionId]) {
                this.clientDecoratorManagers[sessionId].dispose();
                delete this.clientDecoratorManagers[sessionId];
            }
            if (typeof this.highestSendId[sessionId] === 'number') {
                delete this.highestSendId[sessionId];
            }
            // If a viewcolumn was pinned to this participant, unpin it
            for (let i = 1; i <= maximumViewColumns; ++i) {
                const viewColumnInfo = this.viewColumnsPinMap[i];
                if (!viewColumnInfo || viewColumnInfo.pinnedClient !== sessionId) {
                    continue;
                }
                this.unpinByViewColumn(i);
            }
        });
    }
    performUserInitiatedUndo(args) {
        return __awaiter(this, void 0, void 0, function* () {
            let fileClient = this.getSharedFileClientFromEditor(vscode.window.activeTextEditor);
            let wasHandled = (!!fileClient) && fileClient.undoLastLocalEdit();
            if (wasHandled) {
                return;
            }
            // No file client, or not being handled by the client means it's:
            // - not a file we're tracking
            // - not opened it yet (so we can't undo it)
            // - the client didn't have anything special to do so wants the default
            //   undo behaviour
            vscode.commands.executeCommand('default:undo', args);
        });
    }
    performUserInitiatedRedo(args) {
        return __awaiter(this, void 0, void 0, function* () {
            let fileClient = this.getSharedFileClientFromEditor(vscode.window.activeTextEditor);
            let wasHandled = (!!fileClient) && fileClient.redoLastLocalEdit();
            if (wasHandled) {
                return;
            }
            // No file client, or not being handled by the client means it's:
            // - not a file we're tracking
            // - not opened it yet (so we can't undo it)
            // - the client didn't have anything special to do so wants the default
            //   redo behaviour
            vscode.commands.executeCommand('default:redo', args);
        });
    }
    sendCurrentSelectionMessage(forceJumpForId) {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }
        const document = activeEditor.document;
        let currentSelections = activeEditor.selections;
        if ((!currentSelections || !currentSelections.length) && document) {
            // The user hasn't clicked in the file yet. Consider the position to be at the beginning of the file.
            const pos = document.positionAt(0);
            currentSelections.push(new vscode.Selection(pos, pos));
        }
        this.sendSelectionChangeMessage(document, currentSelections, forceJumpForId);
    }
    get activeFileName() {
        return this.fileNameForEditor(vscode.window.activeTextEditor);
    }
    fileNameForEditor(editor) {
        if (!editor || !editor.document) {
            return null;
        }
        const activeUri = editor.document.uri;
        return this.pathConverter.uriToFileName(activeUri);
    }
    sendLayoutChangeMessage(fileName, visibleRanges) {
        const fileClient = this.getSharedFileClient(fileName);
        if (!fileName || !fileClient) {
            return;
        }
        fileClient.onDidChangeTextEditorVisibleRange(fileName, visibleRanges);
    }
    sendSelectionChangeMessage(document, selections, forceJumpForId) {
        const fileName = this.pathConverter.uriToFileName(document.uri);
        const fileClient = this.getSharedFileClient(fileName);
        if (!fileName || !fileClient) {
            return;
        }
        fileClient.onDidChangeTextEditorSelection(selections, fileName, forceJumpForId);
    }
    fireCoEditorsJoined(joinerIds) {
        session_1.SessionContext.collaboratorManager.coEditorsJoined(joinerIds);
        this.coEditorsJoinedEvent.emit(this.coEditorsJoinedEventName, joinerIds);
    }
    updatePinableCommandStatus(isPinnable) {
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.pinnableCommandContext, isPinnable);
    }
    setPinned(isPinned) {
        util_1.ExtensionUtil.setCommandContext(commands_1.Commands.pinnedCommandContext, isPinned);
    }
    updatePinIconFromActiveEditor() {
        const fileName = this.activeFileName;
        if (fileName === null) {
            this.updatePinableCommandStatus(false);
            return;
        }
        this.updatePinableCommandStatus(true);
        const viewColumnInfo = this.viewColumnsPinMap[vscode.window.activeTextEditor.viewColumn];
        if (viewColumnInfo && typeof viewColumnInfo.pinnedClient === 'number') {
            this.setPinned(true);
        }
        else {
            this.setPinned(false);
        }
    }
    handleCoeditorSwitchedFile(sessionId, newFileName) {
        // If we were following this coeditor, set the flag to indicate the document is about to change for the
        // corresponding pinned viewcolumn
        // Note, that at the time of authoring, there are fixed
        // number of view columns.
        for (let i = 1; i <= maximumViewColumns; ++i) {
            const viewColumnInfo = this.viewColumnsPinMap[i];
            if (viewColumnInfo && viewColumnInfo.pinnedClient === sessionId) {
                viewColumnInfo.isChangingDocument = true;
            }
        }
    }
    showJumpFailedNotification() {
        vscode.window.showInformationMessage('The target participant is not currently editing a shared document');
    }
    handleDesync(reason) {
        return __awaiter(this, void 0, void 0, function* () {
            coauthoringTelemetry_1.CoauthoringTelemetry.ReportDesync(reason);
            yield vscode.window.showErrorMessage('You appear to be out of sync. Please rejoin the session.', { modal: true });
            yield extension_1.extensionCommands.leaveCollaboration();
        });
    }
}
// Message management
Client.sendId = 0;
exports.Client = Client;
class ClientFileData {
    constructor(client, fileName, uri, initialText, bufferManagerTrace) {
        this.remoteEdits = 0;
        this.localEdits = 0;
        this.wasLastEditRemote = false;
        this.isMarkedReadOnlyByOwner = false;
        // Counts time since last edit of opposite type (remote / local): [0] is < 1 sec, [1] is <= 1 <= 5 sec, [2] is > 5 sec
        this.editTransitionCounts = [0, 0, 0];
        this.currentFileName = fileName;
        const host = new class {
            constructor() {
                this.clientID = client.clientID;
                this.clientCount = 10;
                this.trace = bufferManagerTrace;
            }
            applyEdit(edits) {
                const workspaceEdit = new vscode.WorkspaceEdit();
                workspaceEdit.set(uri, edits);
                return vscode.workspace.applyEdit(workspaceEdit);
            }
            postMessage(message) {
                client.postMessage(message);
            }
            updateClientPosition(message) {
                client.updateCoEditorPosition(message);
            }
            undoBufferToMatchContents(contentToMatch) {
                let activeDocument = vscode.window.activeTextEditor.document;
                return stepUndoTillContentMatches(contentToMatch, activeDocument);
            }
            performSingleUndo() {
                return new Promise((resolve) => {
                    vscode.commands.executeCommand(`default:undo`, null).then(() => {
                        resolve();
                    });
                });
            }
        };
        this.bufferManager = new vscodeBufferManager_1.VSCodeBufferManager(host, fileName, initialText);
    }
    onDidChangeTextDocument(e) {
        if (this.isMarkedReadOnlyByOwner) {
            return;
        }
        this.updateEditTelemetry(/* isRemoteEdit */ this.waitingForRemoteEditsToBeApplied());
        this.bufferManager.onDidChangeTextDocument(e);
    }
    onDidChangeTextEditorSelection(selections, convertedFileName, forceJumpForId) {
        if (this.isMarkedReadOnlyByOwner) {
            return;
        }
        this.bufferManager.onDidChangeTextEditorSelection(selections, convertedFileName, forceJumpForId);
    }
    onDidChangeTextEditorVisibleRange(fileName, visibleRanges) {
        this.bufferManager.onDidChangeTextEditorVisibleRanges(fileName, visibleRanges);
    }
    onIncomingMessage(message, serverVersionNumber, messageProcessingBehavior = vscodeBufferManager_1.CoeditingIncomingMessageBehavior.QueueAndProcess) {
        this.bufferManager.onIncomingMessage(message, serverVersionNumber, messageProcessingBehavior);
    }
    getStatus() {
        let status = this.bufferManager.getBufferManagerStatus();
        return `sv ${status.serverVersion}, unack ${status.unacknowledgedCount}, remotequeue: ${status.remoteMessagesQueue}`;
    }
    waitingForRemoteEditsToBeApplied() {
        return this.bufferManager.getBufferManagerStatus().waitingForRemoteEditsToBeApplied;
    }
    getBufferContent() {
        return this.bufferManager.getBufferManagerStatus().collabBufferText;
    }
    /**
     * Creates a snapshot of this shared file for late join purposes.
     */
    takeSnapshot() {
        this.bufferManager.takeSnapshot();
    }
    getSavedSnapshotOrFallback(fileHashCode) {
        return this.bufferManager.getSavedSnapshotOrFallback(fileHashCode);
    }
    getCurrentHistory() {
        return this.bufferManager.getCurrentHistory();
    }
    undoLastLocalEdit() {
        return this.bufferManager.undoLastLocalEdit();
    }
    redoLastLocalEdit() {
        return this.bufferManager.redoLastLocalEdit();
    }
    clearUndoStateDueToDocumentClosing() {
        this.bufferManager.clearUndoStateDueToDocumentClosing();
    }
    get fileName() {
        return this.currentFileName;
    }
    updateFileName(newFileName) {
        this.currentFileName = newFileName;
        this.bufferManager.updateFileName(this.currentFileName);
    }
    /**
     * Synchronizes the OT algorithm state for this file with the sharer's.
     */
    initializeHistory(fileOpenAcknowledgeMsg) {
        this.bufferManager.initializeHistory(fileOpenAcknowledgeMsg);
        this.isMarkedReadOnlyByOwner = fileOpenAcknowledgeMsg.isReadOnly;
    }
    /**
     * Drains and processes the queue of remote messages.
     */
    drainMessageQueue() {
        this.bufferManager.processQueuedMessages();
    }
    transformScrollSelectionToCurrent(message) {
        return this.bufferManager.transformScrollSelectionToCurrent(message);
    }
    /**
     * Converts an offset in collaboration buffer coordinates to a VS Code position for the given document.
     */
    toVSCodeDocumentPos(collabOffset, document) {
        return this.bufferManager.toVSCodeDocumentPos(collabOffset, document);
    }
    dispose() {
        coauthoringTelemetry_1.CoauthoringTelemetry.BufferClosed(this.languageId, this.localEdits, this.remoteEdits, this.editTransitionCounts, 0, // Local undos: currently unsupported
        0, // Remote undos: currently unsupported
        0, // Highlights: currently unsupported
        0 // Latency: currently unsupported
        );
    }
    setLanguageId(languageId) {
        this.languageId = languageId;
    }
    updateEditTelemetry(isRemoteEdit) {
        const lastEditTime = this.timeOfLastEdit;
        const now = this.timeOfLastEdit = Date.now();
        const delta = now - lastEditTime;
        if (isRemoteEdit) {
            this.remoteEdits += 1;
        }
        else {
            this.localEdits += 1;
        }
        if (this.wasLastEditRemote === isRemoteEdit) {
            return;
        }
        this.wasLastEditRemote = isRemoteEdit;
        const isFirstEdit = (this.remoteEdits + this.localEdits === 1);
        if (isFirstEdit) {
            return;
        }
        if (delta > ClientFileData.slowEditTransitionTime) {
            this.editTransitionCounts[2] += 1;
        }
        else if (delta < ClientFileData.quickEditTransitionTime) {
            this.editTransitionCounts[0] += 1;
        }
        else {
            this.editTransitionCounts[1] += 1;
        }
    }
}
// Telemetry
ClientFileData.quickEditTransitionTime = 1000; // 1s
ClientFileData.slowEditTransitionTime = 5000; // 5s
exports.ClientFileData = ClientFileData;

//# sourceMappingURL=client.js.map
