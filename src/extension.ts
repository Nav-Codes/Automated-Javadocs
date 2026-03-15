import * as vscode from 'vscode';

type JavaMember = {
	name: string;
	kind: 'method' | 'constructor';
	range: vscode.Range; 
	selectionRange: vscode.Range;
};

type ParamInfo = {
	type: string;
	name: string;
};

type MethodInfo = {
	name: string;
	isConstructor: boolean;
	returnType?: string;
	params: ParamInfo[];
	throws: string[];
	indent: string;
	insertLine: number;
};

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Automated Javadocs');
	context.subscriptions.push(output);

	const disposable = vscode.commands.registerCommand(
		'automated-javadocs.injectJavadocs',
		async () => {
			const editor = vscode.window.activeTextEditor;

			if (!editor) {
				vscode.window.showWarningMessage('No active editor found.');
				return;
			}

			const doc = editor.document;

			if (doc.languageId !== 'java') {
				vscode.window.showWarningMessage('Open a Java file first.');
				return;
			}

			const symbols = await vscode.commands.executeCommand<
				(vscode.DocumentSymbol | vscode.SymbolInformation)[]
			>('vscode.executeDocumentSymbolProvider', doc.uri);

			if (!symbols || symbols.length === 0) {
				vscode.window.showWarningMessage('No Java symbols found.');
				return;
			}

			const members = collectJavaMembers(symbols);

			if (members.length === 0) {
				vscode.window.showInformationMessage('No methods or constructors found.');
				return;
			}

			const edits: Array<{ position: vscode.Position; text: string; name: string }> = [];

			for (const member of members) {
				if (hasJavadocAbove(doc, member.selectionRange.start.line)) {
					output.appendLine(`Skipping ${member.name}: Javadoc already exists.`);
					continue;
				}

				const info = extractMethodInfo(doc, member);

				if (!info) {
					output.appendLine(`Skipping ${member.name}: could not parse signature.`);
					continue;
				}

				const javadoc = generateJavadoc(info);
				edits.push({
					position: new vscode.Position(info.insertLine, 0),
					text: javadoc,
					name: info.name
				});
			}

			if (edits.length === 0) {
				vscode.window.showInformationMessage('No new Javadocs to insert.');
				return;
			}

			// Apply from bottom to top so earlier inserts do not shift later lines
			edits.sort((a, b) => b.position.line - a.position.line);

			const workspaceEdit = new vscode.WorkspaceEdit();
			for (const edit of edits) {
				workspaceEdit.insert(doc.uri, edit.position, edit.text);
			}

			const applied = await vscode.workspace.applyEdit(workspaceEdit);

			if (!applied) {
				vscode.window.showErrorMessage('Failed to apply Javadoc edits.');
				return;
			}

			vscode.window.showInformationMessage(`Inserted ${edits.length} Javadoc comment(s).`);
		}
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {}

function collectJavaMembers(
	symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[]
): JavaMember[] {
	const results: JavaMember[] = [];

	function visit(symbol: vscode.DocumentSymbol | vscode.SymbolInformation) {
		if ('children' in symbol) {
			if (symbol.kind === vscode.SymbolKind.Method) {
				results.push({
					name: symbol.name,
					kind: 'method',
					range: symbol.range,
					selectionRange: symbol.selectionRange
				});
			} else if (symbol.kind === vscode.SymbolKind.Constructor) {
				results.push({
					name: symbol.name,
					kind: 'constructor',
					range: symbol.range,
					selectionRange: symbol.selectionRange
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
					range: symbol.location.range,
					selectionRange: symbol.location.range
				});
			} else if (symbol.kind === vscode.SymbolKind.Constructor) {
				results.push({
					name: symbol.name,
					kind: 'constructor',
					range: symbol.location.range,
					selectionRange: symbol.location.range
				});
			}
		}
	}

	for (const symbol of symbols) {
		visit(symbol);
	}

	return results;
}

function hasJavadocAbove(doc: vscode.TextDocument, declarationLine: number): boolean {
	let line = declarationLine - 1;

	// Skip blank lines directly above the declaration
	while (line >= 0 && doc.lineAt(line).text.trim() === '') {
		line--;
	}

	if (line < 0) {
		return false;
	}

	// Immediate Javadoc end marker above declaration
	if (!doc.lineAt(line).text.trim().endsWith('*/')) {
		return false;
	}

	// Walk upward to find the start of the block
	while (line >= 0) {
		const text = doc.lineAt(line).text.trim();
		if (text.startsWith('/**')) {
			return true;
		}
		if (text.startsWith('/*') && !text.startsWith('/**')) {
			return false;
		}
		line--;
	}

	return false;
}

function extractMethodInfo(doc: vscode.TextDocument, member: JavaMember): MethodInfo | null {
	const startLine = member.selectionRange.start.line;
	const startIndent = getIndent(doc.lineAt(startLine).text);

	// Build the declaration text until the opening brace or semicolon
	let declaration = '';
	let endLine = startLine;

	for (let i = startLine; i < Math.min(doc.lineCount, startLine + 12); i++) {
		const text = doc.lineAt(i).text;
		declaration += text.trim() + ' ';
		endLine = i;

		if (text.includes('{') || text.includes(';')) {
			break;
		}
	}

	declaration = declaration.replace(/\s+/g, ' ').trim();

	const parenStart = declaration.indexOf('(');
	const parenEnd = declaration.lastIndexOf(')');

	if (parenStart === -1 || parenEnd === -1 || parenEnd < parenStart) {
		return null;
	}

	const beforeParen = declaration.slice(0, parenStart).trim();
	const paramText = declaration.slice(parenStart + 1, parenEnd).trim();
	const afterParen = declaration.slice(parenEnd + 1).trim();

	const beforeTokens = beforeParen.split(/\s+/);
	if (beforeTokens.length === 0) {
		return null;
	}

	const name = beforeTokens[beforeTokens.length - 1];
	const isConstructor = member.kind === 'constructor';

	let returnType: string | undefined;
	if (!isConstructor && beforeTokens.length >= 2) {
		returnType = beforeTokens[beforeTokens.length - 2];
	}

	const params = parseParams(paramText);
	const throwsList = parseThrows(afterParen);

	return {
		name,
		isConstructor,
		returnType,
		params,
		throws: throwsList,
		indent: startIndent,
		insertLine: startLine
	};
}

function parseParams(paramText: string): ParamInfo[] {
	if (!paramText.trim()) {
		return [];
	}

	return splitTopLevel(paramText, ',')
		.map((param) => param.trim())
		.filter(Boolean)
		.map((param) => {
			// Remove annotations for a simpler first version
			let cleaned = param.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();

			// Normalize varargs spacing
			cleaned = cleaned.replace(/\s+/g, ' ');

			const parts = cleaned.split(' ');
			if (parts.length < 2) {
				return { type: cleaned, name: 'param' };
			}

			const name = parts[parts.length - 1];
			const type = parts.slice(0, -1).join(' ');

			return { type, name };
		});
}

function parseThrows(afterParen: string): string[] {
	const match = afterParen.match(/throws\s+([^{};]+)/);
	if (!match) {
		return [];
	}

	return match[1]
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function splitTopLevel(text: string, delimiter: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depthAngle = 0;
	let depthParen = 0;
	let depthBracket = 0;

	for (const ch of text) {
		if (ch === '<') depthAngle++;
		else if (ch === '>') depthAngle = Math.max(0, depthAngle - 1);
		else if (ch === '(') depthParen++;
		else if (ch === ')') depthParen = Math.max(0, depthParen - 1);
		else if (ch === '[') depthBracket++;
		else if (ch === ']') depthBracket = Math.max(0, depthBracket - 1);

		if (
			ch === delimiter &&
			depthAngle === 0 &&
			depthParen === 0 &&
			depthBracket === 0
		) {
			parts.push(current);
			current = '';
			continue;
		}

		current += ch;
	}

	if (current) {
		parts.push(current);
	}

	return parts;
}

function generateJavadoc(info: MethodInfo): string {
	const lines: string[] = [];

	lines.push(`${info.indent}/**`);
	lines.push(`${info.indent} * TODO: Describe ${info.name}.`);

	for (const param of info.params) {
		lines.push(`${info.indent} * @param ${param.name} TODO`);
	}

	if (!info.isConstructor && info.returnType && info.returnType !== 'void') {
		lines.push(`${info.indent} * @return TODO`);
	}

	for (const exceptionName of info.throws) {
		lines.push(`${info.indent} * @throws ${exceptionName} TODO`);
	}

	lines.push(`${info.indent} */`);
	lines.push(''); // blank line after javadoc

	return lines.join('\n');
}

function getIndent(lineText: string): string {
	const match = lineText.match(/^(\s*)/);
	return match ? match[1] : '';
}
