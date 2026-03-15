import * as vscode from 'vscode';
import * as path from 'path';
import * as dotenv from 'dotenv';

import { getMethodDescriptionsFromAI } from './openai';
import { buildJavadocEdits } from './javadocGenerator';
import { extractMethodInfos, getJavaMembers } from './javaParser';

const API_KEY_SECRET = 'openaiApiKey';

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Automated Javadocs');
	context.subscriptions.push(output);

	const envPath = path.join(context.extensionPath, '.env');
	const result = dotenv.config({ path: envPath });

	if (result.error) {
		console.log('dotenv failed to load.');
	} else {
		console.log('.env loaded from:', envPath);
	}

	const setApiKeyCommand = vscode.commands.registerCommand(
		'automated-javadocs.setApiKey',
		async () => {
			const apiKey = process.env.OPENAI_API_KEY;

			if (!apiKey) {
				vscode.window.showErrorMessage('OPENAI_API_KEY was not found in .env');
				return;
			}

			await context.secrets.store(API_KEY_SECRET, apiKey);
			vscode.window.showInformationMessage('OpenAI API key saved securely.');
		}
	);

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

				const apiKey = await context.secrets.get(API_KEY_SECRET);
				if (!apiKey) {
					const choice = await vscode.window.showWarningMessage(
						'OpenAI API key not set.',
						'Set API Key'
					);

					if (choice === 'Set API Key') {
						await vscode.commands.executeCommand('automated-javadocs.setApiKey');
					}
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
				output.appendLine('Requesting one-sentence method descriptions from OpenAI...');

				const descriptionMap = await getMethodDescriptionsFromAI(
					javaSource,
					methodInfos,
					apiKey,
					getConfiguredModel()
				);

				output.appendLine(`Received ${descriptionMap.size} method descriptions from AI.`);

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

	context.subscriptions.push(setApiKeyCommand, injectAiJavadocsCommand);
}

export function deactivate() {}

function getConfiguredModel(): string {
	return vscode.workspace
		.getConfiguration('automated-javadocs')
		.get<string>('model', 'gpt-4.1-mini');
}
