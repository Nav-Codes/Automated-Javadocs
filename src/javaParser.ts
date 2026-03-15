import * as vscode from 'vscode';
import type { MethodInfo, ParamInfo } from './backend';

export type JavaMember = {
	name: string;
	kind: 'method' | 'constructor';
	range: vscode.Range;
	selectionRange: vscode.Range;
};

export async function getJavaMembers(
	doc: vscode.TextDocument
): Promise<JavaMember[]> {
	const symbols = await vscode.commands.executeCommand<
		(vscode.DocumentSymbol | vscode.SymbolInformation)[]
	>('vscode.executeDocumentSymbolProvider', doc.uri);

	if (!symbols || symbols.length === 0) {
		return [];
	}

	return collectJavaMembers(symbols);
}

export function collectJavaMembers(
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

export function extractMethodInfos(
	doc: vscode.TextDocument,
	members: JavaMember[],
	output?: vscode.OutputChannel
): MethodInfo[] {
	const methodInfos: MethodInfo[] = [];

	for (const member of members) {
		const info = extractMethodInfo(doc, member);
		if (info) {
			methodInfos.push(info);
		} else {
			output?.appendLine(`Could not parse signature for ${member.name}`);
		}
	}

	return methodInfos;
}

export function extractMethodInfo(
	doc: vscode.TextDocument,
	member: JavaMember
): MethodInfo | null {
	const startLine = member.selectionRange.start.line;
	const startIndent = getIndent(doc.lineAt(startLine).text);

	let declaration = '';

	for (let i = startLine; i < Math.min(doc.lineCount, startLine + 20); i++) {
		const text = doc.lineAt(i).text;
		declaration += text.trim() + ' ';

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

export function parseParams(paramText: string): ParamInfo[] {
	if (!paramText.trim()) {
		return [];
	}

	return splitTopLevel(paramText, ',')
		.map((param) => param.trim())
		.filter(Boolean)
		.map((param) => {
			let cleaned = param.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
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

export function parseThrows(afterParen: string): string[] {
	const match = afterParen.match(/throws\s+([^{};]+)/);
	if (!match) {
		return [];
	}

	return match[1]
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

export function splitTopLevel(text: string, delimiter: string): string[] {
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

export function getIndent(lineText: string): string {
	const match = lineText.match(/^(\s*)/);
	return match ? match[1] : '';
}
