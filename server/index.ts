import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    InitializeResult,
    Position,
    Diagnostic,
    TextDocumentPositionParams,
    CompletionItem,
    CompletionItemKind,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";

import { LexingError, Lexer, Token, TokenType } from "kalang/lexer";
import { Parser, ParserNode, ParsingError } from "kalang/parser";
import { ASTVisitor } from "kalang/visitor";
import { Transpiler, TranspilingError } from "kalang/transpiler";

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {},
        },
    };
    return result;
});

documents.onDidChangeContent((change) => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const diagnostics: Diagnostic[] = [];

    const lexer = new Lexer(textDocument.getText());
    const tokens: Token[] = [];
    let token: Token | null = null;

    do {
        try {
            token = lexer.next();

            tokens.push(token);
        } catch (e) {
            if (e instanceof LexingError) {
                token = null;
                diagnostics.push({
                    message: e.reason,
                    range: {
                        start: textDocument.positionAt(e.pos.index),
                        end: textDocument.positionAt(e.pos.index + 1),
                    },
                });
            }
        }
    } while (!token || token.type !== TokenType.EOF);

    let root: ParserNode | null = null;

    if (diagnostics.length === 0) {
        const parser = new Parser(tokens);

        try {
            root = parser.parse();
        } catch (e) {
            if (e instanceof ParsingError) {
                diagnostics.push({
                    message: e.reason,
                    range: {
                        start: textDocument.positionAt(e.span.start.index),
                        end: textDocument.positionAt(e.span.end.index + 1),
                    },
                });
            }
        }
    }

    const filepath = decodeURIComponent(textDocument.uri).replace("file:///", "");
    if (diagnostics.length === 0 && root) {
        const transpiler = new Transpiler(root, filepath, {
            exists(path) {
                return true;
            },
        });

        try {
            transpiler.transpile();
        } catch (e) {
            if (e instanceof TranspilingError) {
                diagnostics.push({
                    message: e.reason,
                    range: {
                        start: textDocument.positionAt(e.span.start.index),
                        end: textDocument.positionAt(e.span.end.index + 1),
                    },
                });
            }
        }
    }

    connection.sendDiagnostics({
        uri: textDocument.uri,
        diagnostics,
    });
}

connection.onCompletion(async (_textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
    const cursor = { line: _textDocumentPosition.position.line, col: _textDocumentPosition.position.character };
    const text = documents.get(_textDocumentPosition.textDocument.uri)!.getText();
    let ast: ParserNode;

    try {
        const lexer = new Lexer(text);
        const tokens = lexer.lexAll();

        const parser = new Parser(tokens);
        ast = parser.parse();
    } catch (e) {
        return [];
    }

    const visitor = new ASTVisitor(ast);
    visitor.run();

    const scope = visitor.getNodeAtPos(cursor.line, cursor.col - 1);

    if (!scope) {
        return [];
    }

    const allSymbols = scope.list();

    const completionItems: CompletionItem[] = [];

    for (const external of visitor.externVariables.entries()) {
        completionItems.push({
            label: external[0],
            kind: CompletionItemKind.Variable,
        });
    }

    for (const item of allSymbols) {
        const pos = item.meta.definedAt;

        if (pos.line <= cursor.line && pos.col <= cursor.col) {
            completionItems.push({
                label: item.name,
                kind:
                    item.meta.type === "function"
                        ? CompletionItemKind.Function
                        : item.meta.type === "class"
                        ? CompletionItemKind.Class
                        : CompletionItemKind.Variable,
            });
        }
    }

    return completionItems;
});

documents.listen(connection);
connection.listen();
