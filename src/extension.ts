import * as vscode from 'vscode';

import { getMethodDescriptionsFromBackend } from './backend';
import { buildJavadocEdits } from './javadocGenerator';
import { extractMethodInfos, getJavaMembers } from './javaParser';

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Automated Javadocs');
	context.subscriptions.push(output);

	const injectAiJavadocsCommand = vscode.commands.registerCommand(
		'automated-javadocs.injectJavadocs',
		async () => {
			try {
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

				output.clear();
				output.show(true);
				output.appendLine(`Scanning file: ${doc.fileName}`);

				const members = await getJavaMembers(doc);

				if (members.length === 0) {
					vscode.window.showWarningMessage(
						'No Java symbols found. Make sure Java tooling is active.'
					);
					return;
				}

				output.appendLine(`Found ${members.length} methods/constructors from symbol provider.`);

				const methodInfos = extractMethodInfos(doc, members, output);

				if (methodInfos.length === 0) {
					vscode.window.showWarningMessage('Could not parse any method signatures.');
					return;
				}

				const javaSource = doc.getText();
				output.appendLine('Requesting Javadoc descriptions from backend...');

				const descriptionMap = await getMethodDescriptionsFromBackend(
					javaSource,
					methodInfos,
					getConfiguredModel()
				);

				output.appendLine(`Received ${descriptionMap.size} method descriptions from backend.`);

				const edits = buildJavadocEdits(doc, methodInfos, descriptionMap, output);

				if (edits.length === 0) {
					vscode.window.showInformationMessage('No new Javadocs to insert.');
					return;
				}

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

				output.appendLine(`Inserted ${edits.length} Javadocs.`);
				vscode.window.showInformationMessage(`Inserted ${edits.length} Javadoc comment(s).`);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`Automated Javadocs failed: ${message}`);
			}
		}
	);

	context.subscriptions.push(injectAiJavadocsCommand);
}

export function deactivate() {}

function getConfiguredModel(): string {
	return vscode.workspace
		.getConfiguration('automated-javadocs')
		.get<string>('model', 'gpt-4.1-mini');
}
