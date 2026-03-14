import * as vscode from 'vscode';
import { findPsakeFiles, parsePsakeFile, PsakeTaskInfo } from './psakeParser.js';
import { PsakeModuleResolver, enrichModuleTasks } from './moduleResolver.js';
import { logError } from './log.js';

/**
 * Provides IntelliSense completions for the "task" property inside
 * psake task definitions in .vscode/tasks.json.
 *
 * When the user is editing a JSON object with `"type": "psake"` and
 * places the cursor on the `"task"` value, this provider suggests
 * all task names discovered from the workspace's psakefile(s).
 */
export class PsakeTaskCompletionProvider implements vscode.CompletionItemProvider {
    private cachedTasks: PsakeTaskInfo[] | undefined;
    private cacheTime = 0;
    private static readonly CACHE_TTL_MS = 5000;
    private readonly resolver: PsakeModuleResolver | undefined;

    constructor(watcher: vscode.FileSystemWatcher, resolver?: PsakeModuleResolver) {
        this.resolver = resolver;
        const invalidate = (): void => { this.cachedTasks = undefined; };
        watcher.onDidChange(invalidate);
        watcher.onDidCreate(invalidate);
        watcher.onDidDelete(invalidate);
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<vscode.CompletionItem[] | undefined> {
        // Only operate on .vscode/tasks.json
        if (!document.uri.fsPath.replace(/\\/g, '/').endsWith('.vscode/tasks.json')) {
            return undefined;
        }

        // Check if the cursor is inside a psake task definition's "task" value
        if (!this.isInsidePsakeTaskValue(document, position)) {
            return undefined;
        }

        const taskInfos = await this.getTaskInfos();
        if (!taskInfos.length) {
            return undefined;
        }

        return taskInfos.map((info, index) => {
            const item = new vscode.CompletionItem(info.name, vscode.CompletionItemKind.Value);
            item.detail = info.description || `psake task`;
            item.sortText = String(index).padStart(4, '0');

            const docParts: string[] = [];
            if (info.fromModule) {
                docParts.push(`**From module:** \`${info.fromModule}\``);
                if (info.requiredVersion) { docParts.push(`Required version: ${info.requiredVersion}`); }
                if (info.minimumVersion) { docParts.push(`Minimum version: ≥ ${info.minimumVersion}`); }
                if (info.maximumVersion) { docParts.push(`Maximum version: ≤ ${info.maximumVersion}`); }
                if (info.lessThanVersion) { docParts.push(`Less than version: ${info.lessThanVersion}`); }
                if (info.moduleResolved === false) { docParts.push(`⚠ Module not found or version constraint not satisfied.`); }
            }
            if (info.dependencies.length > 0) {
                docParts.push(`**Depends on:** ${info.dependencies.join(', ')}`);
            }
            if (docParts.length > 0) {
                item.documentation = new vscode.MarkdownString(docParts.join('\n\n'));
            }

            return item;
        });
    }

    /**
     * Determines whether the cursor is on the value side of a `"task"` key
     * within an object that has `"type": "psake"`.
     *
     * Uses a simple text-based heuristic: scans backward from the cursor to
     * find the containing object, then checks for the `"type": "psake"` pair.
     */
    private isInsidePsakeTaskValue(document: vscode.TextDocument, position: vscode.Position): boolean {
        const text = document.getText();
        const offset = document.offsetAt(position);

        // Find the "task" key that the cursor is the value of.
        // Look backward for `"task"` followed by `:` then the cursor.
        const before = text.slice(0, offset);
        const taskKeyMatch = before.match(/"task"\s*:\s*"?[^"]*$/);
        if (!taskKeyMatch) {
            return false;
        }

        // Now check that the containing object has "type": "psake"
        // Walk backward to find the opening `{` of this object
        const objectStart = this.findContainingObjectStart(text, before.length - taskKeyMatch[0].length);
        if (objectStart < 0) {
            return false;
        }

        // Find the matching `}` (approximate — just look at a chunk)
        const objectEnd = this.findMatchingBrace(text, objectStart);
        const objectText = text.slice(objectStart, objectEnd + 1);

        return /"type"\s*:\s*"psake"/.test(objectText);
    }

    private findContainingObjectStart(text: string, fromOffset: number): number {
        let depth = 0;
        for (let i = fromOffset; i >= 0; i--) {
            const ch = text[i];
            if (ch === '}' || ch === ']') {
                depth++;
            } else if (ch === '[') {
                depth--;
            } else if (ch === '{') {
                if (depth === 0) {
                    return i;
                }
                depth--;
            }
        }
        return -1;
    }

    private findMatchingBrace(text: string, openOffset: number): number {
        let depth = 0;
        for (let i = openOffset; i < text.length; i++) {
            const ch = text[i];
            if (ch === '{' || ch === '[') {
                depth++;
            } else if (ch === '}' || ch === ']') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return text.length - 1;
    }

    private async getTaskInfos(): Promise<PsakeTaskInfo[]> {
        const now = Date.now();
        if (this.cachedTasks && now - this.cacheTime < PsakeTaskCompletionProvider.CACHE_TTL_MS) {
            return this.cachedTasks;
        }

        const tasks: PsakeTaskInfo[] = [];
        try {
            const uris = await findPsakeFiles();
            for (const uri of uris) {
                const bytes = await vscode.workspace.fs.readFile(uri);
                const content = Buffer.from(bytes).toString('utf8');
                tasks.push(...parsePsakeFile(content));
            }
            if (this.resolver) {
                await enrichModuleTasks(tasks, this.resolver);
            }
        } catch (err) {
            logError(err, false);
        }

        this.cachedTasks = tasks;
        this.cacheTime = now;
        return tasks;
    }
}
