import * as vscode from 'vscode';
import * as path from 'path';
import * as childProcess from 'child_process';
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
    private watcherDisposables: vscode.Disposable[] = [];
    private detectedExecutable: string | undefined;
    /** Cached build script path per workspace folder URI */
    private buildScriptCache = new Map<string, string | undefined>();

    constructor(watcher: vscode.FileSystemWatcher) {
        this.bindWatcher(watcher);
    }

    setWatcher(watcher: vscode.FileSystemWatcher): void {
        this.watcherDisposables.forEach(d => d.dispose());
        this.watcherDisposables = [];
        this.cachedTasks = undefined;
        this.buildScriptCache.clear();
        this.detectedExecutable = undefined;
        this.bindWatcher(watcher);
    }

    private bindWatcher(watcher: vscode.FileSystemWatcher): void {
        const invalidate = (): void => { this.cachedTasks = undefined; this.buildScriptCache.clear(); };
        this.watcherDisposables.push(
            watcher.onDidChange(invalidate),
            watcher.onDidCreate(invalidate),
            watcher.onDidDelete(invalidate),
        );
    }

    async provideTasks(): Promise<vscode.Task[]> {
        if (this.cachedTasks) {
            return this.cachedTasks;
        }
        // Detect the PowerShell executable before building tasks so the
        // cached result is available for buildTask (which is synchronous).
        await this.detectPowerShellExecutable();
        this.cachedTasks = await this.detectTasks();
        return this.cachedTasks;
    }

    /**
     * Called by VS Code when it needs to resolve a task that was defined in
     * tasks.json — e.g. { "type": "psake", "task": "Build" }.
     * We fill in the ShellExecution so the task is runnable.
     */
    async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
        const def = task.definition as PsakeTaskDefinition;
        if (!def.task) {
            return undefined;
        }

        const scope = task.scope;
        if (!scope || typeof scope === 'number') {
            return undefined;
        }

        const folder = scope as vscode.WorkspaceFolder;
        const buildScript = await this.resolveBuildScript(folder);
        return this.buildTask(def, folder, undefined, buildScript);
    }

    /**
     * Public helper used by the runTask command so it can execute tasks
     * created from tree view items without going through the full provider cycle.
     */
    async resolveTaskFromDefinition(
        def: vscode.TaskDefinition,
        folder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const buildScript = await this.resolveBuildScript(folder);
        return this.buildTask(def as PsakeTaskDefinition, folder, undefined, buildScript);
    }

    // -------------------------------------------------------------------------
    // PowerShell executable detection
    // -------------------------------------------------------------------------

    /**
     * Detects which PowerShell executable is available on the system.
     * Prefers pwsh (PowerShell 7+), falls back to powershell (Windows PowerShell 5.1).
     * Caches the result for the lifetime of the provider.
     */
    private async detectPowerShellExecutable(): Promise<string> {
        if (this.detectedExecutable) {
            return this.detectedExecutable;
        }

        const config = vscode.workspace.getConfiguration('psake');
        const configured: string = config.get('powershellExecutable') ?? '';
        if (configured) {
            this.detectedExecutable = configured;
            return configured;
        }

        const candidates = ['pwsh', 'powershell'];
        for (const exe of candidates) {
            if (await this.testExecutable(exe)) {
                this.detectedExecutable = exe;
                return exe;
            }
        }

        // Fall back to pwsh and let the error surface when the task runs
        return 'pwsh';
    }

    private testExecutable(executable: string): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const ps = childProcess.spawn(
                executable,
                ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Host "OK"'],
                { shell: true }
            );

            let hasOutput = false;
            ps.stdout.on('data', () => { hasOutput = true; });
            ps.on('close', (code: number) => resolve(code === 0 && hasOutput));
            ps.on('error', () => resolve(false));
        });
    }

    // -------------------------------------------------------------------------
    // Build script detection
    // -------------------------------------------------------------------------

    /**
     * Resolves the build script path for a workspace folder.
     * Returns the relative path to the script, or undefined if tasks should
     * use Invoke-psake directly.
     *
     * Resolution order:
     * 1. `psake.buildScript` set to "none" → no build script
     * 2. `psake.buildScript` set to a path → use that path
     * 3. `psake.buildScript` empty → auto-detect build.ps1 in workspace root
     */
    private async resolveBuildScript(folder: vscode.WorkspaceFolder): Promise<string | undefined> {
        const key = folder.uri.toString();
        if (this.buildScriptCache.has(key)) {
            return this.buildScriptCache.get(key);
        }

        const config = vscode.workspace.getConfiguration('psake', folder);
        const configured: string = config.get('buildScript') ?? '';

        let result: string | undefined;

        if (configured.toLowerCase() === 'none') {
            result = undefined;
        } else if (configured) {
            result = configured;
        } else {
            // Auto-detect build.ps1 in workspace root
            const buildPs1 = vscode.Uri.joinPath(folder.uri, 'build.ps1');
            try {
                await vscode.workspace.fs.stat(buildPs1);
                result = 'build.ps1';
            } catch {
                result = undefined;
            }
        }

        this.buildScriptCache.set(key, result);
        return result;
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

        // Group URIs by workspace folder so we resolve the build script once per folder
        const folderMap = new Map<string, { folder: vscode.WorkspaceFolder; uris: vscode.Uri[] }>();
        for (const uri of uris) {
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            if (!folder) {
                continue;
            }
            const key = folder.uri.toString();
            if (!folderMap.has(key)) {
                folderMap.set(key, { folder, uris: [] });
            }
            folderMap.get(key)!.uris.push(uri);
        }

        for (const { folder, uris: folderUris } of folderMap.values()) {
            const buildScript = await this.resolveBuildScript(folder);

            for (const uri of folderUris) {
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
                        tasks.push(this.buildTask(def, folder, info.description, buildScript));
                    }
                } catch (err) {
                    logError(err, false);
                }
            }
        }

        return tasks;
    }

    private buildTask(
        def: PsakeTaskDefinition,
        folder: vscode.WorkspaceFolder,
        description?: string,
        buildScript?: string
    ): vscode.Task {
        const config = vscode.workspace.getConfiguration('psake', folder);
        const defaultFile: string = config.get('buildFile') ?? 'psakefile.ps1';
        const buildFile = def.file ?? defaultFile;

        const extraInvokeParams: string = config.get('invokeParameters') ?? '';
        const extraScriptParams: string = config.get('buildScriptParameters') ?? '';
        const command = buildScript
            ? buildBuildScriptCommand(buildScript, def.task, config.get('buildScriptTaskParameter') ?? 'Task', extraScriptParams)
            : buildInvokePsakeCommand(buildFile, def.task, extraInvokeParams);

        // Use the detected executable asynchronously; fall back to pwsh
        // if detection hasn't completed yet (resolveTask is sync).
        const executable = this.detectedExecutable ?? 'pwsh';
        const extraShellArgs: string[] = config.get('shellArgs') ?? ['-NoProfile'];

        const task = new vscode.Task(
            def,
            folder,
            def.task,
            'psake',
            new vscode.ShellExecution(command, {
                executable,
                shellArgs: [...extraShellArgs, '-Command'],
            }),
            []
        );

        task.detail = description ?? `Run psake task '${def.task}'`;

        if (def.task.toLowerCase() === 'default') {
            task.group = vscode.TaskGroup.Build;
        }

        return task;
    }
}

function buildInvokePsakeCommand(buildFile: string, taskName: string, extraParams?: string): string {
    const escapedFile = buildFile.replace(/'/g, "''");
    const escapedTask = taskName.replace(/'/g, "''");
    const extra = extraParams ? ` ${extraParams}` : '';
    return `Invoke-psake -buildFile '${escapedFile}' -taskList '${escapedTask}'${extra}`;
}

function buildBuildScriptCommand(scriptPath: string, taskName: string, parameterName: string, extraParams?: string): string {
    const escapedScript = scriptPath.replace(/'/g, "''");
    const escapedTask = taskName.replace(/'/g, "''");
    const escapedParam = parameterName.replace(/^-/, '');
    const extra = extraParams ? ` ${extraParams}` : '';
    return `./'${escapedScript}' -${escapedParam} '${escapedTask}'${extra}`;
}
