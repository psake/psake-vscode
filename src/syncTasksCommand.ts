import * as vscode from 'vscode';
import * as path from 'path';
import { findPsakeFiles, parsePsakeFile } from './psakeParser.js';
import { TASK_TYPE } from './constants.js';
import { logError } from './log.js';
import { classifyByName, TaskClass } from './taskClassifier.js';

interface TasksJsonContent {
    version: string;
    tasks: TaskEntry[];
    [key: string]: unknown;
}

interface TaskEntry {
    type: string;
    task?: string;
    label?: string;
    file?: string;
    group?: string | { kind: string; isDefault?: boolean };
    problemMatcher?: string | string[];
    [key: string]: unknown;
}

/**
 * Reads all psake tasks from workspace psakefiles and merges them into
 * .vscode/tasks.json. Existing psake entries whose task name still exists
 * in the psakefile are preserved (so user customizations like problemMatcher
 * or group aren't lost). New tasks are added; stale ones can be removed.
 */
export async function syncTasksCommand(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        void vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }

    // Pick folder if multi-root
    let folder: vscode.WorkspaceFolder;
    if (folders.length === 1) {
        folder = folders[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            folders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f })),
            { placeHolder: 'Select the workspace folder to sync tasks for' }
        );
        if (!picked) {
            return;
        }
        folder = picked.folder;
    }

    // Discover psake tasks for this folder
    const uris = await findPsakeFiles();
    const folderUris = uris.filter(u => {
        const wf = vscode.workspace.getWorkspaceFolder(u);
        return wf && wf.uri.toString() === folder.uri.toString();
    });

    if (!folderUris.length) {
        void vscode.window.showWarningMessage('No psake build files found in this workspace folder.');
        return;
    }

    const discoveredTasks: { name: string; file: string; description: string }[] = [];
    for (const uri of folderUris) {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const content = Buffer.from(bytes).toString('utf8');
            const infos = parsePsakeFile(content);
            const relFile = path.relative(folder.uri.fsPath, uri.fsPath);
            for (const info of infos) {
                discoveredTasks.push({ name: info.name, file: relFile, description: info.description });
            }
        } catch (err) {
            logError(err, false);
        }
    }

    if (!discoveredTasks.length) {
        void vscode.window.showWarningMessage('No psake tasks found in the build file(s).');
        return;
    }

    // Read or create tasks.json
    const tasksJsonUri = vscode.Uri.joinPath(folder.uri, '.vscode', 'tasks.json');
    let tasksJson: TasksJsonContent;

    try {
        const bytes = await vscode.workspace.fs.readFile(tasksJsonUri);
        const raw = Buffer.from(bytes).toString('utf8');
        tasksJson = JSON.parse(raw) as TasksJsonContent;
        if (!Array.isArray(tasksJson.tasks)) {
            tasksJson.tasks = [];
        }
    } catch {
        // File doesn't exist or is invalid — create fresh
        tasksJson = { version: '2.0.0', tasks: [] };
    }

    // Build a set of existing psake task keys for deduplication
    const existingPsakeKeys = new Set<string>();
    for (const entry of tasksJson.tasks) {
        if (entry.type === TASK_TYPE && entry.task) {
            existingPsakeKeys.add(taskKey(entry.task, entry.file));
        }
    }

    // Filter to tasks that will actually be added (new ones)
    const newTasks = discoveredTasks.filter(dt => !existingPsakeKeys.has(taskKey(dt.name, dt.file)));

    if (newTasks.length === 0) {
        void vscode.window.showInformationMessage('tasks.json is already up to date with all psake tasks.');
        return;
    }

    // Classify new tasks by name, then let the user confirm/adjust.
    const config = vscode.workspace.getConfiguration('psake', folder);
    const problemMatcherEnabled: boolean = config.get('problemMatcher.enabled') ?? true;
    const classifyEnabled: boolean = config.get('classifyByName') ?? true;

    const classifications = new Map<string, TaskClass>();
    for (const dt of newTasks) {
        classifications.set(taskKey(dt.name, dt.file), classifyEnabled ? classifyByName(dt.name) : 'none');
    }

    if (classifyEnabled) {
        const adjusted = await promptClassifications(newTasks, classifications);
        if (!adjusted) {
            // User cancelled
            return;
        }
    }

    // Add new tasks
    let added = 0;
    for (const dt of newTasks) {
        const cls = classifications.get(taskKey(dt.name, dt.file)) ?? 'none';
        const matchers = problemMatcherEnabled
            ? (cls === 'test'
                ? ['$psake', '$psake-powershell', '$pester']
                : ['$psake', '$psake-powershell'])
            : undefined;

        const entry: TaskEntry = {
            type: TASK_TYPE,
            task: dt.name,
            file: dt.file,
            label: `psake: ${dt.name}`,
            ...(cls !== 'none' && { group: cls }),
            ...(matchers && { problemMatcher: matchers }),
        };

        tasksJson.tasks.push(entry);
        added++;
    }

    // Ensure .vscode directory exists
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.vscode'));
    } catch {
        // Directory may already exist
    }

    // Write tasks.json with nice formatting
    const output = JSON.stringify(tasksJson, null, '\t');
    await vscode.workspace.fs.writeFile(tasksJsonUri, Buffer.from(output, 'utf8'));

    // Open the file so the user can review
    const doc = await vscode.workspace.openTextDocument(tasksJsonUri);
    await vscode.window.showTextDocument(doc);

    void vscode.window.showInformationMessage(
        `Added ${added} psake task${added === 1 ? '' : 's'} to tasks.json.`
    );
}

function taskKey(name: string, file?: string): string {
    return `${(file ?? '').toLowerCase()}::${name.toLowerCase()}`;
}

interface DiscoveredTask {
    name: string;
    file: string;
    description: string;
}

/**
 * Shows two sequential multi-select prompts (test, then build) to let the user
 * confirm or override the heuristic classification. Mutates the supplied
 * classifications map. Returns false if the user cancelled either prompt.
 */
async function promptClassifications(
    tasks: DiscoveredTask[],
    classifications: Map<string, TaskClass>
): Promise<boolean> {
    interface Item extends vscode.QuickPickItem {
        key: string;
    }

    const items: Item[] = tasks.map(dt => ({
        key: taskKey(dt.name, dt.file),
        label: dt.name,
        description: dt.file,
        detail: dt.description || undefined,
    }));

    // Test pass: pre-select heuristic-test tasks
    const testPicks = await vscode.window.showQuickPick(
        items.map(it => ({ ...it, picked: classifications.get(it.key) === 'test' })),
        {
            canPickMany: true,
            title: 'psake: Sync Tasks (1/2) — which tasks are Test tasks?',
            placeHolder: 'Selected tasks will get group="test" and the $pester problem matcher. Press Enter to confirm.',
        }
    );
    if (!testPicks) {
        return false;
    }
    const testKeys = new Set(testPicks.map(p => p.key));

    // Build pass: pre-select heuristic-build tasks, excluding any marked as test
    const buildCandidates = items.filter(it => !testKeys.has(it.key));
    const buildPicks = await vscode.window.showQuickPick(
        buildCandidates.map(it => ({ ...it, picked: classifications.get(it.key) === 'build' })),
        {
            canPickMany: true,
            title: 'psake: Sync Tasks (2/2) — which tasks are Build tasks?',
            placeHolder: 'Selected tasks will get group="build". Press Enter to confirm.',
        }
    );
    if (!buildPicks) {
        return false;
    }
    const buildKeys = new Set(buildPicks.map(p => p.key));

    // Apply user choices
    for (const it of items) {
        if (testKeys.has(it.key)) {
            classifications.set(it.key, 'test');
        } else if (buildKeys.has(it.key)) {
            classifications.set(it.key, 'build');
        } else {
            classifications.set(it.key, 'none');
        }
    }
    return true;
}
