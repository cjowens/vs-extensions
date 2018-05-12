"use strict";
/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_1 = require("vscode");
const vscode_languageclient_1 = require("vscode-languageclient");
const Settings = require("../settings");
exports.CommentHelpRequestType = new vscode_languageclient_1.RequestType("powerShell/getCommentHelp");
var SearchState;
(function (SearchState) {
    SearchState[SearchState["Searching"] = 0] = "Searching";
    SearchState[SearchState["Locked"] = 1] = "Locked";
    SearchState[SearchState["Found"] = 2] = "Found";
})(SearchState || (SearchState = {}));
class HelpCompletionFeature {
    constructor(log) {
        this.log = log;
        this.settings = Settings.load();
        if (this.settings.helpCompletion !== Settings.HelpCompletion.Disabled) {
            this.helpCompletionProvider = new HelpCompletionProvider();
            const subscriptions = [];
            vscode_1.workspace.onDidChangeTextDocument(this.onEvent, this, subscriptions);
            this.disposable = vscode_1.Disposable.from(...subscriptions);
        }
    }
    dispose() {
        if (this.disposable) {
            this.disposable.dispose();
        }
    }
    setLanguageClient(languageClient) {
        this.languageClient = languageClient;
        if (this.helpCompletionProvider) {
            this.helpCompletionProvider.languageClient = languageClient;
        }
    }
    onEvent(changeEvent) {
        if (!(changeEvent && changeEvent.contentChanges)) {
            this.log.write(`Bad TextDocumentChangeEvent message: ${JSON.stringify(changeEvent)}`);
            return;
        }
        if (changeEvent.contentChanges.length > 0) {
            this.helpCompletionProvider.updateState(changeEvent.document, changeEvent.contentChanges[0].text, changeEvent.contentChanges[0].range);
            // todo raise an event when trigger is found, and attach complete() to the event.
            if (this.helpCompletionProvider.triggerFound) {
                this.helpCompletionProvider.complete().then(() => this.helpCompletionProvider.reset());
            }
        }
    }
}
exports.HelpCompletionFeature = HelpCompletionFeature;
class TriggerFinder {
    constructor(triggerCharacters) {
        this.triggerCharacters = triggerCharacters;
        this.state = SearchState.Searching;
        this.count = 0;
    }
    get found() {
        return this.state === SearchState.Found;
    }
    updateState(document, changeText) {
        switch (this.state) {
            case SearchState.Searching:
                if (changeText.length === 1 && changeText[0] === this.triggerCharacters[this.count]) {
                    this.state = SearchState.Locked;
                    this.document = document;
                    this.count++;
                }
                break;
            case SearchState.Locked:
                if (document === this.document &&
                    changeText.length === 1 &&
                    changeText[0] === this.triggerCharacters[this.count]) {
                    this.count++;
                    if (this.count === this.triggerCharacters.length) {
                        this.state = SearchState.Found;
                    }
                }
                else {
                    this.reset();
                }
                break;
            default:
                this.reset();
                break;
        }
    }
    reset() {
        this.state = SearchState.Searching;
        this.count = 0;
    }
}
class HelpCompletionProvider {
    constructor() {
        this.triggerFinderHelpComment = new TriggerFinder("##");
        this.settings = Settings.load();
    }
    get triggerFound() {
        return this.triggerFinderHelpComment.found;
    }
    set languageClient(value) {
        this.langClient = value;
    }
    updateState(document, changeText, changeRange) {
        this.lastDocument = document;
        this.lastChangeText = changeText;
        this.lastChangeRange = changeRange;
        this.triggerFinderHelpComment.updateState(document, changeText);
    }
    reset() {
        this.triggerFinderHelpComment.reset();
    }
    complete() {
        if (this.langClient === undefined) {
            return;
        }
        const change = this.lastChangeText;
        const triggerStartPos = this.lastChangeRange.start;
        const triggerEndPos = this.lastChangeRange.end;
        const doc = this.lastDocument;
        return this.langClient.sendRequest(exports.CommentHelpRequestType, {
            documentUri: doc.uri.toString(),
            triggerPosition: triggerStartPos,
            blockComment: this.settings.helpCompletion === Settings.HelpCompletion.BlockComment,
        }).then((result) => {
            if (result == null || result.content == null) {
                return;
            }
            // todo add indentation level to the help content
            const editor = vscode_1.window.activeTextEditor;
            const replaceRange = new vscode_1.Range(triggerStartPos.translate(0, -1), triggerStartPos.translate(0, 1));
            // Trim leading whitespace (used by the rule for indentation) as VSCode takes care of the indentation.
            // Trim the last empty line and join the strings.
            const text = result.content.map((x) => x.trimLeft()).slice(0, -1).join(this.getEOL(doc.eol));
            editor.insertSnippet(new vscode_1.SnippetString(text), replaceRange);
        });
    }
    getEOL(eol) {
        // there are only two type of EndOfLine types.
        if (eol === vscode_1.EndOfLine.CRLF) {
            return "\r\n";
        }
        return "\n";
    }
}
//# sourceMappingURL=HelpCompletion.js.map