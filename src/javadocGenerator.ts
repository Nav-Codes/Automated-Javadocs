import * as vscode from 'vscode';
import { type MethodDocItem, buildSignature, type MethodInfo } from './openai';

export type JavadocInsertEdit = {
	position: vscode.Position;
	text: string;
	signature: string;
};

export function buildJavadocEdits(
	doc: vscode.TextDocument,
	methodInfos: MethodInfo[],
	descriptionMap: Map<string, MethodDocItem>,
	output?: vscode.OutputChannel
): JavadocInsertEdit[] {
	const edits: JavadocInsertEdit[] = [];

	for (const info of methodInfos) {
		if (hasJavadocAbove(doc, info.insertLine)) {
			output?.appendLine(`Skipping ${buildSignature(info)}: existing Javadoc found.`);
			continue;
		}

		const signature = buildSignature(info);
		const docItem = descriptionMap.get(signature) ?? fallbackDescription(info);
		const javadoc = generateJavadoc(info, docItem);

		edits.push({
			position: new vscode.Position(info.insertLine, 0),
			text: javadoc,
			signature
		});
	}

	return edits;
}

export function hasJavadocAbove(
	doc: vscode.TextDocument,
	declarationLine: number
): boolean {
	let line = declarationLine - 1;

	while (line >= 0 && doc.lineAt(line).text.trim() === '') {
		line--;
	}

	if (line < 0) {
		return false;
	}

	if (!doc.lineAt(line).text.trim().endsWith('*/')) {
		return false;
	}

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

export function generateJavadoc(info: MethodInfo, docItem: MethodDocItem): string {
	const lines: string[] = [];

	lines.push(`${info.indent}/**`);
	lines.push(`${info.indent} * ${docItem.description}`);

	for (const param of info.params) {
		const paramDescription =
			docItem.params.find((p) => p.name === param.name)?.description ?? 'TODO';

		lines.push(`${info.indent} * @param ${param.name} ${paramDescription}`);
	}

	if (!info.isConstructor && info.returnType && info.returnType !== 'void') {
		lines.push(
			`${info.indent} * @return ${docItem.returnDescription ?? 'TODO'}`
		);
	}

	for (const exceptionName of info.throws) {
		const throwsDescription =
			docItem.throws.find((t) => t.type === exceptionName)?.description ?? 'TODO';

		lines.push(`${info.indent} * @throws ${exceptionName} ${throwsDescription}`);
	}

	lines.push(`${info.indent} */`);
	lines.push('');

	return lines.join('\n');
}


export function fallbackDescription(info: MethodInfo): MethodDocItem {
	return {
		signature: buildSignature(info),
		description: info.isConstructor
			? `Creates a new ${info.name} instance.`
			: `Executes ${info.name}.`,
		params: info.params.map((p) => ({
			name: p.name,
			description: 'the input value'
		})),
		returnDescription:
			!info.isConstructor && info.returnType && info.returnType !== 'void'
				? 'the result'
				: null,
		throws: info.throws.map((t) => ({
			type: t,
			description: 'an exception if an error occurs'
		}))
	};
}