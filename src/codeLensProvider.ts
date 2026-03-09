import * as vscode from 'vscode';
import * as path from 'path';
import { parsePsakeFile } from './psakeParser.js';

export class PsakeCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor(watcher: vscode.FileSystemWatcher) {
        watcher.onDidChange(() => this._onDidChangeCodeLenses.fire());
        watcher.onDidCreate(() => this._onDidChangeCodeLenses.fire());
        watcher.onDidDelete(() => this._onDidChangeCodeLenses.fire());
    }

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const config = vscode.workspace.getConfiguration('psake');
        if (config.get('codeLens.enabled') === false) {
            return [];
        }
        if (!this.isPsakeFile(document)) {
            return [];
        }

        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!folder) {
            return [];
        }

        const tasks = parsePsakeFile(document.getText());
        const relativeFile = path.relative(folder.uri.fsPath, document.uri.fsPath);

        return tasks.map(task => {
            const range = new vscode.Range(task.line, 0, task.line, 0);
            return new vscode.CodeLens(range, {
                title: '$(play) Run Task',
                command: 'psake.runTask',
                arguments: [{
                    taskName: task.name,
                    buildFile: relativeFile,
                    workspaceFolder: folder,
                }],
            });
        });
    }

    private isPsakeFile(document: vscode.TextDocument): boolean {
        if (document.languageId !== 'powershell') {
            return false;
        }
        const config = vscode.workspace.getConfiguration('psake');
        const buildFileName: string = config.get('buildFile') ?? 'psakefile.ps1';
        return path.basename(document.uri.fsPath).toLowerCase() === buildFileName.toLowerCase();
    }
}
