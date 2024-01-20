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

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            // completionProvider: {
            //     resolveProvider: true,
            // },
            completionProvider: {},
        },
    };
    return result;
});

// connection.onInitialized(() => {
// });

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    // connection.sendDiagnostics({
    //     uri: textDocument.uri,
    //     diagnostics: [
    //         {
    //             severity: DiagnosticSeverity.Error,
    //             range: { start: textDocument.positionAt(0), end: textDocument.positionAt(2) },
    //             message: "test error",
    //             source: "ex",
    //         } satisfies Diagnostic,
    //     ],
    // });

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

    if (diagnostics.length === 0) {
        const parser = new Parser(tokens);

        try {
            parser.parse();
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

    connection.sendDiagnostics({
        uri: textDocument.uri,
        diagnostics,
    });
}

// This handler provides the initial list of the completion items.
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

    const allVars = scope.listVariables();
    const allFuncts = scope.listFunctions();

    const completionItems: CompletionItem[] = [];

    for (const item of [...allVars, ...allFuncts]) {
        const pos = item[1].definedAt;

        if (pos.line <= cursor.line && pos.col <= cursor.col) {
            completionItems.push({
                label: item[0],
                kind: item[1].type === "function" ? CompletionItemKind.Function : CompletionItemKind.Variable,
            });
        }
    }

    return completionItems;
    // return [
    //     {
    //         label: "TypeScript",
    //         kind: CompletionItemKind.Text,
    //         data: 1,
    //     },
    //     {
    //         label: "JavaScript",
    //         kind: CompletionItemKind.Text,
    //         data: 2,
    //     },
    // ];
});

// // This handler resolves additional information for the item selected in
// // the completion list.
// connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
//     if (item.data === 1) {
//         item.detail = "TypeScript details";
//         item.documentation = "TypeScript documentation";
//     } else if (item.data === 2) {
//         item.detail = "JavaScript details";
//         item.documentation = "JavaScript documentation";
//     }
//     return item;
// });

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
