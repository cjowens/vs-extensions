"use strict";
//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//
Object.defineProperty(exports, "__esModule", { value: true });
class LanguageFilterMiddleWare {
    constructor() {
        this.filteredLanguages = ['csharp', 'typescript', 'javascript'];
    }
    isFilteredDocument(document) {
        if (this.filteredLanguages.indexOf(document.languageId) >= 0) {
            return true;
        }
        return false;
    }
    provideCompletionItem(document, position, context, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, context, token);
    }
    provideHover(document, position, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, token);
    }
    provideSignatureHelp(document, position, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, token);
    }
    provideDefinition(document, position, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, token);
    }
    provideReferences(document, position, options, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, options, token);
    }
    provideImplementation(document, position, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, token);
    }
    provideDocumentHighlights(document, position, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, token);
    }
    provideDocumentSymbols(document, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, token);
    }
    provideCodeActions(document, range, context, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, range, context, token);
    }
    provideCodeLenses(document, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, token);
    }
    provideDocumentFormattingEdits(document, options, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, options, token);
    }
    provideDocumentRangeFormattingEdits(document, range, options, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, range, options, token);
    }
    provideOnTypeFormattingEdits(document, position, ch, options, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, ch, options, token);
    }
    provideRenameEdits(document, position, newName, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, position, newName, token);
    }
    provideDocumentLinks(document, token, next) {
        return this.isFilteredDocument(document) ? undefined : next(document, token);
    }
}
exports.LanguageFilterMiddleWare = LanguageFilterMiddleWare;

//# sourceMappingURL=languageFilterMiddleWare.js.map
