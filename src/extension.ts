import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Automated Javadocs');
	context.subscriptions.push(output);

	const disposable = vscode.commands.registerCommand(
		'automated-javadocs.scanWithSymbols',
		async () => {
			const editor = vscode.window.activeTextEditor;

			if (!editor) {
				vscode.window.showWarningMessage('No active editor found.');
				return;
			}

			const doc = editor.document;
			output.clear();
			output.show(true);

			output.appendLine(`file: ${doc.fileName}`);
			output.appendLine(`languageId: ${doc.languageId}`);

			const javaExt = vscode.extensions.getExtension('redhat.java');
			output.appendLine(`redhat.java installed: ${!!javaExt}`);

			if (doc.languageId !== 'java') {
				vscode.window.showWarningMessage(`This file is not detected as Java. languageId=${doc.languageId}`);
				return;
			}

			if (javaExt && !javaExt.isActive) {
				output.appendLine('Activating redhat.java...');
				await javaExt.activate();
			}

			// small delay can help if Java is still warming up
			await new Promise((resolve) => setTimeout(resolve, 1500));

			const symbols = await vscode.commands.executeCommand<
				(vscode.DocumentSymbol | vscode.SymbolInformation)[]
			>('vscode.executeDocumentSymbolProvider', doc.uri);

			output.appendLine(`raw symbols returned: ${symbols ? symbols.length : 0}`);
			output.appendLine(JSON.stringify(symbols, null, 2));

			if (!symbols || symbols.length === 0) {
				vscode.window.showWarningMessage('No symbols returned. Check Output panel.');
				return;
			}

			const results = collectMethodAndConstructorSymbols(symbols);

			output.appendLine('');
			output.appendLine(`methods/constructors found: ${results.length}`);
			for (const r of results) {
				output.appendLine(`${r.kind}: ${r.name} @ line ${r.line + 1}`);
			}

			vscode.window.showInformationMessage(
				`Found ${results.length} methods/constructors.`
			);
		}
	);

	context.subscriptions.push(disposable);
}

function collectMethodAndConstructorSymbols(
	symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[]
): Array<{ name: string; kind: 'method' | 'constructor'; line: number }> {
	const results: Array<{ name: string; kind: 'method' | 'constructor'; line: number }> = [];

	function visit(symbol: vscode.DocumentSymbol | vscode.SymbolInformation) {
		if ('children' in symbol) {
			if (symbol.kind === vscode.SymbolKind.Method) {
				results.push({
					name: symbol.name,
					kind: 'method',
					line: symbol.selectionRange.start.line
				});
			} else if (symbol.kind === vscode.SymbolKind.Constructor) {
				results.push({
					name: symbol.name,
					kind: 'constructor',
					line: symbol.selectionRange.start.line
				});
			}

			for (const child of symbol.children) {
				visit(child);
			}
		} else {
			if (symbol.kind === vscode.SymbolKind.Method) {
				results.push({
					name: symbol.name,
					kind: 'method',
					line: symbol.location.range.start.line
				});
			} else if (symbol.kind === vscode.SymbolKind.Constructor) {
				results.push({
					name: symbol.name,
					kind: 'constructor',
					line: symbol.location.range.start.line
				});
			}
		}
	}

	for (const symbol of symbols) {
		visit(symbol);
	}

	return results;
}
