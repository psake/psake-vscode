import * as vscode from 'vscode';
import * as path from 'path';
import { findPsakeFiles } from './psakeParser.js';
import { TASK_TYPE } from './constants.js';
import { logError } from './log.js';
import { detectPowerShellExecutable } from './powershellUtils.js';
import { PsakeModuleResolver, resolveAllTasks } from './moduleResolver.js';
import { classifyByName } from './taskClassifier.js';

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
    /** Cached build script path per directory URI */
    private buildScriptCache = new Map<string, string | undefined>();
    private readonly resolver: PsakeModuleResolver | undefined;

    constructor(watcher: vscode.FileSystemWatcher, resolver?: PsakeModuleResolver) {
        this.resolver = resolver;
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
        await this.getExecutable();
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
        const defaultFile: string = vscode.workspace.getConfiguration('psake', folder).get('buildFile') ?? 'psakefile.ps1';
        const relFile = def.file ?? defaultFile;
        const psakeFileDir = path.resolve(folder.uri.fsPath, path.dirname(relFile));
        const dirUri = vscode.Uri.file(psakeFileDir);
        const buildScript = await this.resolveBuildScript(folder, dirUri);
        return this.buildTask(def, folder, undefined, buildScript, psakeFileDir);
    }

    /**
     * Public helper used by the runTask command so it can execute tasks
     * created from tree view items without going through the full provider cycle.
     */
    async resolveTaskFromDefinition(
        def: vscode.TaskDefinition,
        folder: vscode.WorkspaceFolder
    ): Promise<vscode.Task> {
        const pDef = def as PsakeTaskDefinition;
        const defaultFile: string = vscode.workspace.getConfiguration('psake', folder).get('buildFile') ?? 'psakefile.ps1';
        const relFile = pDef.file ?? defaultFile;
        const psakeFileDir = path.resolve(folder.uri.fsPath, path.dirname(relFile));
        const dirUri = vscode.Uri.file(psakeFileDir);
        const buildScript = await this.resolveBuildScript(folder, dirUri);
        return this.buildTask(pDef, folder, undefined, buildScript, psakeFileDir);
    }

    // -------------------------------------------------------------------------
    // PowerShell executable detection
    // -------------------------------------------------------------------------

    /** Returns the cached PowerShell executable, detecting it on first call. */
    private async getExecutable(): Promise<string> {
        if (this.detectedExecutable) {
            return this.detectedExecutable;
        }
        this.detectedExecutable = await detectPowerShellExecutable();
        return this.detectedExecutable;
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
     * 3. `psake.buildScript` empty → auto-detect build.ps1 in psakefile directory
     */
    private async resolveBuildScript(folder: vscode.WorkspaceFolder, dirUri?: vscode.Uri): Promise<string | undefined> {
        const searchUri = dirUri ?? folder.uri;
        const key = searchUri.toString();
        if (this.buildScriptCache.has(key)) {
            return this.buildScriptCache.get(key);
        }

        const config = vscode.workspace.getConfiguration('psake', folder);
        const configured: string = config.get('buildScript') ?? '';

        let result: string | undefined;

        if (configured.toLowerCase() === 'none') {
            result = undefined;
        } else if (configured) {
            result = path.resolve(folder.uri.fsPath, configured);
        } else {
            // Auto-detect build.ps1 in the psakefile's directory (case-insensitive)
            try {
                const files = await vscode.workspace.fs.readDirectory(searchUri);
                const buildFile = files.find(([name, type]) =>
                    type === vscode.FileType.File &&
                    name.toLowerCase() === 'build.ps1'
                );
                result = buildFile ? buildFile[0] : undefined;
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

        // Group URIs by workspace folder
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
            for (const uri of folderUris) {
                const psakeFileDir = path.dirname(uri.fsPath);
                const dirUri = vscode.Uri.file(psakeFileDir);
                const buildScript = await this.resolveBuildScript(folder, dirUri);

                try {
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    const content = Buffer.from(bytes).toString('utf8');
                    const psakeTaskInfos = await resolveAllTasks(content, uri, this.resolver);
                    const relativeFile = path.relative(folder.uri.fsPath, uri.fsPath);

                    for (const info of psakeTaskInfos) {
                        const def: PsakeTaskDefinition = {
                            type: TASK_TYPE,
                            task: info.name,
                            file: relativeFile,
                        };
                        tasks.push(this.buildTask(def, folder, info.description, buildScript, psakeFileDir));
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
        buildScript?: string,
        psakeFileDir?: string
    ): vscode.Task {
        const config = vscode.workspace.getConfiguration('psake', folder);
        const defaultFile: string = config.get('buildFile') ?? 'psakefile.ps1';
        const buildFile = def.file ?? defaultFile;
        // Always resolve to an absolute path so the command works regardless of cwd
        const invokeFile = path.resolve(folder.uri.fsPath, buildFile);

        const extraInvokeParams: string = config.get('invokeParameters') ?? '';
        const extraScriptParams: string = config.get('buildScriptParameters') ?? '';
        const command = buildScript
            ? buildBuildScriptCommand(buildScript, def.task, config.get('buildScriptTaskParameter') ?? 'Task', extraScriptParams)
            : buildInvokePsakeCommand(invokeFile, def.task, extraInvokeParams);

        // Use the already-detected executable; fall back to pwsh if not yet detected.
        const executable = this.detectedExecutable ?? 'pwsh';
        const extraShellArgs: string[] = config.get('shellArgs') ?? ['-NoProfile'];

        const problemMatcherEnabled: boolean = config.get('problemMatcher.enabled') ?? true;
        const classifyEnabled: boolean = config.get('classifyByName') ?? true;

        const shellOptions: vscode.ShellExecutionOptions = {
            executable,
            shellArgs: [...extraShellArgs, '-Command'],
            cwd: psakeFileDir,
        };

        if (problemMatcherEnabled) {
            shellOptions.env = { PSAKE_OUTPUT_FORMAT: 'Annotated' };
        }

        const cls = classifyEnabled ? classifyByName(def.task) : 'none';
        const matchers = problemMatcherEnabled
            ? (cls === 'test'
                ? ['$psake', '$psake-powershell', '$pester']
                : ['$psake', '$psake-powershell'])
            : [];

        const task = new vscode.Task(
            def,
            folder,
            def.task,
            'psake',
            new vscode.ShellExecution(command, shellOptions),
            matchers
        );

        task.detail = description || `Run psake task '${def.task}'`;

        if (cls === 'test') {
            task.group = vscode.TaskGroup.Test;
        } else if (cls === 'build' || def.task.toLowerCase() === 'default') {
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
    const prefix = path.isAbsolute(scriptPath) ? `& '${escapedScript}'` : `./'${escapedScript}'`;
    return `${prefix} -${escapedParam} '${escapedTask}'${extra}`;
}
