import * as vscode from 'vscode';
import * as path from 'path';
import { findPsakeFiles, parsePsakeFile, PsakeTaskInfo } from './psakeParser.js';
import { PsakeModuleResolver, enrichModuleTasks } from './moduleResolver.js';
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

        // Description
        if (info.fromModule) {
            if (info.moduleResolved === false) {
                this.description = `⚠ not found: ${info.fromModule}`;
            } else {
                const depsStr = info.dependencies.length > 0
                    ? ` · depends: ${info.dependencies.join(', ')}`
                    : '';
                this.description = `from: ${info.fromModule}${depsStr}`;
            }
        } else {
            this.description = info.description || (info.dependencies.length > 0
                ? `depends: ${info.dependencies.join(', ')}`
                : '');
        }

        // Tooltip
        const tooltipParts: string[] = [`**${info.name}**`];
        if (info.description) {
            tooltipParts.push(`\n\n${info.description}`);
        }
        if (info.fromModule) {
            tooltipParts.push(`\n\n*From module:* \`${info.fromModule}\``);
            const versionParts: string[] = [];
            if (info.requiredVersion) { versionParts.push(`version ${info.requiredVersion}`); }
            if (info.minimumVersion) { versionParts.push(`≥ ${info.minimumVersion}`); }
            if (info.maximumVersion) { versionParts.push(`≤ ${info.maximumVersion}`); }
            if (info.lessThanVersion) { versionParts.push(`< ${info.lessThanVersion}`); }
            if (versionParts.length > 0) {
                tooltipParts.push(` *(${versionParts.join(', ')})*`);
            }
            if (info.moduleResolved === false) {
                tooltipParts.push(`\n\n⚠ *Module not found or version constraint not satisfied.*`);
            }
        }
        if (info.dependencies.length > 0) {
            tooltipParts.push(`\n\n*Depends on:* ${info.dependencies.join(', ')}`);
        }
        this.tooltip = new vscode.MarkdownString(tooltipParts.join(''));

        // Icon
        if (info.name.toLowerCase() === 'default') {
            this.iconPath = new vscode.ThemeIcon('home');
        } else if (info.fromModule) {
            this.iconPath = new vscode.ThemeIcon(
                info.moduleResolved === false ? 'warning' : 'package'
            );
        } else {
            this.iconPath = new vscode.ThemeIcon('play-circle');
        }

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
    private readonly resolver: PsakeModuleResolver | undefined;

    private watcherDisposables: vscode.Disposable[] = [];

    constructor(watcher: vscode.FileSystemWatcher, resolver?: PsakeModuleResolver) {
        this.resolver = resolver;
        this.bindWatcher(watcher);
    }

    setWatcher(watcher: vscode.FileSystemWatcher): void {
        this.watcherDisposables.forEach(d => d.dispose());
        this.watcherDisposables = [];
        this.bindWatcher(watcher);
    }

    private bindWatcher(watcher: vscode.FileSystemWatcher): void {
        this.watcherDisposables.push(
            watcher.onDidChange(() => this.refresh()),
            watcher.onDidCreate(() => this.refresh()),
            watcher.onDidDelete(() => this.refresh()),
        );
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
                if (this.resolver) {
                    await enrichModuleTasks(tasks, this.resolver);
                }
                this.cache.set(uri.toString(), { uri, folder, tasks });
            } catch (err) {
                logError(err, false);
            }
        }
    }
}
