import * as vscode from 'vscode';
import { installBuildFileCommand } from './buildFile/psakeBuildFileCommand';

export function activate(context: vscode.ExtensionContext): void {
    // Register the build file command.
    context.subscriptions.push(vscode.commands.registerCommand('psake.buildFile', async () => {
        installBuildFileCommand();
    }));
}
