import * as vscode from 'vscode';
import * as path from 'path';
import { findPsakeFiles, parsePsakeFile } from './psakeParser.js';
import { TASK_TYPE } from './constants.js';
import { logError } from './log.js';

export interface PsakeTaskDefinition extends vscode.TaskDefinition {
    type: 'psake';
    /** The psake task name */
    task: string;
    /** Relative path to the build file within the workspace folder */
    file?: string;
}

export class PsakeTaskProvider implements vscode.TaskProvider {
    private cachedTasks: vscode.Task[] | undefined;

    constructor(watcher: vscode.FileSystemWatcher) {
        watcher.onDidChange(() => { this.cachedTasks = undefined; });
        watcher.onDidCreate(() => { this.cachedTasks = undefined; });
        watcher.onDidDelete(() => { this.cachedTasks = undefined; });
    }

    async provideTasks(): Promise<vscode.Task[]> {
        if (this.cachedTasks) {
            return this.cachedTasks;
        }
        this.cachedTasks = await this.detectTasks();
        return this.cachedTasks;
    }

    /**
     * Called by VS Code when it needs to resolve a task that was defined in
     * tasks.json — e.g. { "type": "psake", "task": "Build" }.
     * We fill in the ShellExecution so the task is runnable.
     */
    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const def = task.definition as PsakeTaskDefinition;
        if (!def.task) {
            return undefined;
        }

        const scope = task.scope;
        if (!scope || typeof scope === 'number') {
            // scope is TaskScope.Global or TaskScope.Workspace (numeric enum) — no folder
            return undefined;
        }

        return this.buildTask(def, scope as vscode.WorkspaceFolder);
    }

    /**
     * Public helper used by the runTask command so it can execute tasks
     * created from tree view items without going through the full provider cycle.
     */
    resolveTaskFromDefinition(
        def: vscode.TaskDefinition,
        folder: vscode.WorkspaceFolder
    ): vscode.Task {
        return this.buildTask(def as PsakeTaskDefinition, folder);
    }

    // -------------------------------------------------------------------------

    private async detectTasks(): Promise<vscode.Task[]> {
        const config = vscode.workspace.getConfiguration('psake');
        const enabled: boolean = config.get('taskProvider.enabled') ?? true;
        if (!enabled) {
            return [];
        }

        const uris = await findPsakeFiles();
        const tasks: vscode.Task[] = [];

        for (const uri of uris) {
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                continue;
            }

            try {
                const bytes = await vscode.workspace.fs.readFile(uri);
                const content = Buffer.from(bytes).toString('utf8');
                const psakeTaskInfos = parsePsakeFile(content);
                const relativeFile = path.relative(folder.uri.fsPath, uri.fsPath);

                for (const info of psakeTaskInfos) {
                    const def: PsakeTaskDefinition = {
                        type: TASK_TYPE,
                        task: info.name,
                        file: relativeFile,
                    };
                    tasks.push(this.buildTask(def, folder, info.description));
                }
            } catch (err) {
                logError(err, false);
            }
        }

        return tasks;
    }

    private buildTask(
        def: PsakeTaskDefinition,
        folder: vscode.WorkspaceFolder,
        description?: string
    ): vscode.Task {
        const config = vscode.workspace.getConfiguration('psake');
        const defaultFile: string = config.get('buildFile') ?? 'psakefile.ps1';
        const buildFile = def.file ?? defaultFile;

        // Invoke-psake runs via PowerShell. Use the PowerShell extension's
        // terminal profile when available; otherwise fall back to pwsh/powershell.
        const command = buildInvokePsakeCommand(buildFile, def.task);

        const task = new vscode.Task(
            def,
            folder,
            def.task,
            'psake',
            new vscode.ShellExecution(command, {
                executable: 'pwsh',
                shellArgs: ['-NoProfile', '-Command'],
            }),
            // Use the PowerShell problem matcher if installed, otherwise none
            []
        );

        task.detail = description ?? `Run psake task '${def.task}'`;

        if (def.task.toLowerCase() === 'default') {
            task.group = vscode.TaskGroup.Build;
        }

        return task;
    }
}

function buildInvokePsakeCommand(buildFile: string, taskName: string): string {
    // Quote the file path in case it contains spaces
    const escapedFile = buildFile.replace(/'/g, "''");
    const escapedTask = taskName.replace(/'/g, "''");
    return `Invoke-psake -buildFile '${escapedFile}' -taskList '${escapedTask}'`;
}
