import * as vscode from 'vscode';
import { PsakeTaskProvider } from './taskProvider.js';
import { PsakeTreeDataProvider } from './treeView.js';
import { installBuildFileCommand } from './scaffoldCommand.js';

export function activate(context: vscode.ExtensionContext): void {
    // Register the scaffold command (available even without a psakefile)
    context.subscriptions.push(
        vscode.commands.registerCommand('psake.buildFile', installBuildFileCommand)
    );

    // Task provider and tree view only make sense when there is a workspace
    if (!vscode.workspace.workspaceFolders?.length) {
        return;
    }

    // Set up shared file watcher for psakefile changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/psakefile.ps1');
    context.subscriptions.push(watcher);

    // Tree View
    const treeProvider = new PsakeTreeDataProvider(watcher);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('psakeTasksView', treeProvider)
    );

    // Task Provider
    const taskProvider = new PsakeTaskProvider(watcher);
    context.subscriptions.push(
        vscode.tasks.registerTaskProvider('psake', taskProvider)
    );

    // Tree view commands
    context.subscriptions.push(
        vscode.commands.registerCommand('psake.refreshTasks', () => {
            treeProvider.refresh();
        }),

        vscode.commands.registerCommand('psake.runTask', async (item?: { taskName: string; buildFile: string; workspaceFolder: vscode.WorkspaceFolder }) => {
            if (!item) {
                return;
            }
            const def: vscode.TaskDefinition = { type: 'psake', task: item.taskName, file: item.buildFile };
            const resolved = await taskProvider.resolveTaskFromDefinition(def, item.workspaceFolder);
            if (resolved) {
                await vscode.tasks.executeTask(resolved);
            }
        }),

        vscode.commands.registerCommand('psake.openTaskDefinition', async (item?: { buildFileUri: vscode.Uri; line: number }) => {
            if (!item) {
                return;
            }
            const doc = await vscode.workspace.openTextDocument(item.buildFileUri);
            const editor = await vscode.window.showTextDocument(doc);
            const position = new vscode.Position(item.line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        })
    );
}

export function deactivate(): void {
    // Disposables are cleaned up via context.subscriptions
}
