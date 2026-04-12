import * as vscode from 'vscode';
import * as path from 'path';
import { findPsakeFiles, parsePsakeFile } from './psakeParser.js';
import { TASK_TYPE } from './constants.js';
import { logError } from './log.js';

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

    // Add new tasks
    const config = vscode.workspace.getConfiguration('psake', folder);
    const problemMatcherEnabled: boolean = config.get('problemMatcher.enabled') ?? true;
    let added = 0;
    for (const dt of discoveredTasks) {
        const key = taskKey(dt.name, dt.file);
        if (existingPsakeKeys.has(key)) {
            continue;
        }

        const entry: TaskEntry = {
            type: TASK_TYPE,
            task: dt.name,
            file: dt.file,
            label: `psake: ${dt.name}`,
            ...(problemMatcherEnabled && { problemMatcher: ['$psake', '$psake-powershell'] }),
        };

        tasksJson.tasks.push(entry);
        added++;
    }

    if (added === 0) {
        void vscode.window.showInformationMessage('tasks.json is already up to date with all psake tasks.');
        return;
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
