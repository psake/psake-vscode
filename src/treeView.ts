import * as vscode from 'vscode';
import * as path from 'path';
import { findPsakeFiles, parsePsakeFile, PsakeTaskInfo } from './psakeParser.js';
import { logError } from './log.js';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

export class PsakeBuildFileItem extends vscode.TreeItem {
    readonly uri: vscode.Uri;
    readonly workspaceFolder: vscode.WorkspaceFolder;

    constructor(uri: vscode.Uri, folder: vscode.WorkspaceFolder) {
        const label = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1
            ? `${folder.name} — ${path.basename(uri.fsPath)}`
            : path.basename(uri.fsPath);

        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.uri = uri;
        this.workspaceFolder = folder;
        this.resourceUri = uri;
        this.contextValue = 'psakeBuildFile';
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.tooltip = uri.fsPath;
    }
}

export class PsakeTaskItem extends vscode.TreeItem {
    readonly taskName: string;
    readonly buildFile: string;
    readonly buildFileUri: vscode.Uri;
    readonly workspaceFolder: vscode.WorkspaceFolder;
    readonly taskLine: number;

    constructor(info: PsakeTaskInfo, buildFileUri: vscode.Uri, folder: vscode.WorkspaceFolder) {
        super(info.name, vscode.TreeItemCollapsibleState.None);

        this.taskName = info.name;
        this.buildFile = path.relative(folder.uri.fsPath, buildFileUri.fsPath);
        this.buildFileUri = buildFileUri;
        this.workspaceFolder = folder;
        this.taskLine = info.line;
        this.contextValue = 'psakeTask';

        this.description = info.description || (info.dependencies.length > 0
            ? `depends: ${info.dependencies.join(', ')}`
            : '');

        this.tooltip = new vscode.MarkdownString(
            [
                `**${info.name}**`,
                info.description ? `\n\n${info.description}` : '',
                info.dependencies.length > 0 ? `\n\n*Depends on:* ${info.dependencies.join(', ')}` : '',
            ].join('')
        );

        this.iconPath = new vscode.ThemeIcon(
            info.name.toLowerCase() === 'default' ? 'home' : 'play-circle'
        );

        // Clicking a task item opens the file at the task's line
        this.command = {
            command: 'psake.openTaskDefinition',
            title: 'Go to Task Definition',
            arguments: [{ buildFileUri, line: info.line }],
        };
    }
}

type PsakeTreeItem = PsakeBuildFileItem | PsakeTaskItem;

// ---------------------------------------------------------------------------
// Tree Data Provider
// ---------------------------------------------------------------------------

export class PsakeTreeDataProvider implements vscode.TreeDataProvider<PsakeTreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<PsakeTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** Cached map of build file URI → parsed tasks */
    private cache = new Map<string, { uri: vscode.Uri; folder: vscode.WorkspaceFolder; tasks: PsakeTaskInfo[] }>();
    private loaded = false;

    constructor(watcher: vscode.FileSystemWatcher) {
        watcher.onDidChange(() => this.refresh());
        watcher.onDidCreate(() => this.refresh());
        watcher.onDidDelete(() => this.refresh());
    }

    refresh(): void {
        this.loaded = false;
        this.cache.clear();
        this._onDidChangeTreeData.fire(null);
    }

    getTreeItem(element: PsakeTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PsakeTreeItem): Promise<PsakeTreeItem[]> {
        if (!element) {
            // Root level: return build file items
            await this.ensureLoaded();
            const items: PsakeBuildFileItem[] = [];
            for (const entry of this.cache.values()) {
                items.push(new PsakeBuildFileItem(entry.uri, entry.folder));
            }
            await vscode.commands.executeCommand('setContext', 'psake:hasTaskFile', items.length > 0);
            return items;
        }

        if (element instanceof PsakeBuildFileItem) {
            const entry = this.cache.get(element.uri.toString());
            if (!entry) {
                return [];
            }
            return entry.tasks.map(t => new PsakeTaskItem(t, element.uri, element.workspaceFolder));
        }

        return [];
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) {
            return;
        }
        this.loaded = true;
        this.cache.clear();

        const uris = await findPsakeFiles();
        for (const uri of uris) {
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                continue;
            }
            try {
                const bytes = await vscode.workspace.fs.readFile(uri);
                const content = Buffer.from(bytes).toString('utf8');
                const tasks = parsePsakeFile(content);
                this.cache.set(uri.toString(), { uri, folder, tasks });
            } catch (err) {
                logError(err, false);
            }
        }
    }
}
