/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const summaryStartTag = /<summary>/i;
const summaryEndTag = /<\/summary>/i;
function extractSummaryText(xmlDocComment) {
    if (!xmlDocComment) {
        return xmlDocComment;
    }
    let summary = xmlDocComment;
    let startIndex = summary.search(summaryStartTag);
    if (startIndex < 0) {
        return summary;
    }
    summary = summary.slice(startIndex + '<summary>'.length);
    let endIndex = summary.search(summaryEndTag);
    if (endIndex < 0) {
        return summary;
    }
    return summary.slice(0, endIndex);
}
exports.extractSummaryText = extractSummaryText;
function GetDocumentationString(structDoc) {
    let newLine = "\n\n";
    let indentSpaces = "\t\t";
    let documentation = "";
    if (structDoc.SummaryText) {
        documentation += structDoc.SummaryText + newLine;
    }
    if (structDoc.TypeParamElements && structDoc.TypeParamElements.length > 0) {
        documentation += "Type Parameters:" + newLine;
        documentation += indentSpaces + structDoc.TypeParamElements.map(displayDocumentationObject).join("\n" + indentSpaces) + newLine;
    }
    if (structDoc.ParamElements && structDoc.ParamElements.length > 0) {
        documentation += "Parameters:" + newLine;
        documentation += indentSpaces + structDoc.ParamElements.map(displayDocumentationObject).join("\n" + indentSpaces) + newLine;
    }
    if (structDoc.ReturnsText) {
        documentation += structDoc.ReturnsText + newLine;
    }
    if (structDoc.RemarksText) {
        documentation += structDoc.RemarksText + newLine;
    }
    if (structDoc.ExampleText) {
        documentation += structDoc.ExampleText + newLine;
    }
    if (structDoc.ValueText) {
        documentation += structDoc.ValueText + newLine;
    }
    if (structDoc.Exception && structDoc.Exception.length > 0) {
        documentation += "Exceptions:" + newLine;
        documentation += indentSpaces + structDoc.Exception.map(displayDocumentationObject).join("\n" + indentSpaces) + newLine;
    }
    documentation = documentation.trim();
    return documentation;
}
exports.GetDocumentationString = GetDocumentationString;
function displayDocumentationObject(obj) {
    return obj.Name + ": " + obj.Documentation;
}
exports.displayDocumentationObject = displayDocumentationObject;

//# sourceMappingURL=documentation.js.map
