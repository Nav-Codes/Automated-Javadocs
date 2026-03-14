// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "automated-javadocs" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	// const disposable = vscode.commands.registerCommand('automated-javadocs.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		// vscode.window.showInformationMessage('Say hi to urmom for me');
	// });

	const methodScanner = vscode.commands.registerCommand('automated-javadocs.scanJavaMethods', () => {
		const editor = vscode.window.activeTextEditor;

		if (!editor) {
			vscode.window.showWarningMessage('No active editor found.');
			return;
		}

		if (editor.document.languageId !== 'java') {
			vscode.window.showWarningMessage('Open a Java file first.');
			return;
		}

		const text = editor.document.getText();
		const methodNames = findJavaMethods(text);

		if (methodNames.length === 0) {
			vscode.window.showInformationMessage('No Java methods found.');
			console.log('No Java methods found.');
			return;
		}

		console.log('Detected Java methods/constructors:');
		for (const name of methodNames) {
			console.log(name);
		}

		vscode.window.showInformationMessage(
			`Found ${methodNames.length} method(s)/constructor(s). Check the debug console.`
		);
	});

	// context.subscriptions.push(disposable);
	context.subscriptions.push(methodScanner);
}

// This method is called when your extension is deactivated
export function deactivate() { }

function findJavaMethods(sourceCode: string): string[] {
	const names: string[] = [];

	/*
		This regex tries to match:
		- optional annotations
		- optional access/static/final/etc modifiers
		- optional generic return type
		- return type
		- method/constructor name
		- parameter list
		- opening brace

		It is intentionally simple for a first pass.
	*/
	const methodRegex =
		/(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|static|final|synchronized|abstract|native|strictfp)\s+)*(?:<[^>]+>\s+)?(?:[\w\[\]<>.,?]+\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*(?:throws\s+[\w\s,<>.?]+)?\s*\{/g;

	let match: RegExpExecArray | null;
	while ((match = methodRegex.exec(sourceCode)) !== null) {
		const name = match[1];

		// Skip common control-flow keywords accidentally matched
		if (['if', 'for', 'while', 'switch', 'catch', 'do', 'try', 'else'].includes(name)) {
			continue;
		}

		names.push(name);
	}

	return names;
}