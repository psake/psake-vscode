import * as vscode from 'vscode';
import { PsakeTaskProvider } from './taskProvider.js';
import { PsakeTreeDataProvider } from './treeView.js';
import { PsakeTaskCompletionProvider } from './tasksJsonCompletionProvider.js';
import { PsakeCodeLensProvider } from './codeLensProvider.js';
import { installBuildFileCommand } from './scaffoldCommand.js';
import { syncTasksCommand } from './syncTasksCommand.js';
import { findPsakeFiles } from './psakeParser.js';

function getBuildFilePattern(): string {
    const config = vscode.workspace.getConfiguration('psake');
    const buildFile: string = config.get('buildFile') ?? 'psakefile.ps1';
    return `**/${buildFile}`;
}

export function activate(context: vscode.ExtensionContext): void {
    // Register the scaffold command (available even without a psakefile)
    context.subscriptions.push(
        vscode.commands.registerCommand('psake.buildFile', installBuildFileCommand)
    );

    // Task provider and tree view only make sense when there is a workspace
    if (!vscode.workspace.workspaceFolders?.length) {
        return;
    }

    // Set up file watcher using the configured build file name
    let watcher = vscode.workspace.createFileSystemWatcher(getBuildFilePattern());
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

    // IntelliSense for "task" values in tasks.json when type is "psake"
    const tasksJsonSelector: vscode.DocumentSelector = {
        language: 'jsonc',
        pattern: '**/.vscode/tasks.json',
    };
    const completionProvider = new PsakeTaskCompletionProvider(watcher);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(tasksJsonSelector, completionProvider, '"')
    );

    // CodeLens: "▶ Run Task" above each Task declaration in psakefile
    const codeLensProvider = new PsakeCodeLensProvider(watcher);
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'powershell', pattern: getBuildFilePattern() },
            codeLensProvider
        )
    );

    // Command to sync discovered psake tasks into tasks.json
    context.subscriptions.push(
        vscode.commands.registerCommand('psake.syncTasks', syncTasksCommand)
    );

    // Set the hasTaskFile context key eagerly so the tree view appears
    void updateHasTaskFileContext();

    watcher.onDidCreate(() => void updateHasTaskFileContext());
    watcher.onDidDelete(() => void updateHasTaskFileContext());

    // Re-create the watcher when the build file setting changes
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('psake.buildFile')) {
            watcher.dispose();
            watcher = vscode.workspace.createFileSystemWatcher(getBuildFilePattern());
            treeProvider.setWatcher(watcher);
            taskProvider.setWatcher(watcher);
            treeProvider.refresh();
            void updateHasTaskFileContext();
        }
    }, undefined, context.subscriptions);

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
            const resolved = taskProvider.resolveTaskFromDefinition(def, item.workspaceFolder);
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

async function updateHasTaskFileContext(): Promise<void> {
    const files = await findPsakeFiles();
    await vscode.commands.executeCommand('setContext', 'psake:hasTaskFile', files.length > 0);
}

export function deactivate(): void {
    // Disposables are cleaned up via context.subscriptions
}
