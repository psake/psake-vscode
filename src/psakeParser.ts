import * as vscode from 'vscode';

export interface PsakeTaskInfo {
    name: string;
    dependencies: string[];
    description: string;
    /** Zero-based line number where the Task declaration begins */
    line: number;
    /** Module name supplied via the -FromModule parameter (SharedTask parameter set) */
    fromModule?: string;
    /** Version constraints for the -FromModule module */
    requiredVersion?: string;
    minimumVersion?: string;
    maximumVersion?: string;
    lessThanVersion?: string;
    /**
     * Populated by the module resolver after attempting to locate the named module.
     * true  = module found and task metadata merged.
     * false = module not found or version constraint not satisfied.
     * undefined = task has no -FromModule, or resolution hasn't been run yet.
     */
    moduleResolved?: boolean;
}

/**
 * Parses a psakefile.ps1 and extracts all Task definitions.
 *
 * Handles these common patterns:
 *
 *   Task default -Depends Test, Build
 *   Task -Name Build -Depends Clean -Description "Compiles the project" { ... }
 *   Task "Release" -Depends @(Build, Test) -Action { ... }
 */
export function parsePsakeFile(content: string): PsakeTaskInfo[] {
    const tasks: PsakeTaskInfo[] = [];
    const lines = content.split(/\r?\n/);

    // Join continuation lines (trailing backtick `) so multi-line declarations
    // can be matched by a single-line regex pass.
    const joined = joinContinuationLines(lines);

    for (let i = 0; i < joined.length; i++) {
        const { text, originalLine } = joined[i];

        // Skip comments and empty lines quickly
        const trimmed = text.trimStart();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const task = parseTaskLine(trimmed, originalLine);
        if (task) {
            tasks.push(task);
        }
    }

    return tasks;
}

/**
 * Converts a filename to a case-insensitive glob pattern.
 * Example: "psakefile.ps1" -> "[pP][sS][aA][kK][eE][fF][iI][lL][eE].ps1"
 */
function toCaseInsensitivePattern(filename: string): string {
    return filename.split('').map(char => {
        if (/[a-zA-Z]/.test(char)) {
            return `[${char.toLowerCase()}${char.toUpperCase()}]`;
        }
        return char;
    }).join('');
}

/**
 * Discovers all psakefile.ps1 files in the current workspace.
 * Uses case-insensitive matching to find files regardless of casing.
 */
export async function findPsakeFiles(): Promise<vscode.Uri[]> {
    const config = vscode.workspace.getConfiguration('psake');
    const buildFileName: string = config.get('buildFile') ?? 'psakefile.ps1';
    const caseInsensitiveFileName = toCaseInsensitivePattern(buildFileName);
    const pattern = `**/${caseInsensitiveFileName}`;
    return vscode.workspace.findFiles(pattern, '**/node_modules/**');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface JoinedLine {
    text: string;
    /** The original (zero-based) line index where this logical line starts */
    originalLine: number;
}

function joinContinuationLines(lines: string[]): JoinedLine[] {
    const result: JoinedLine[] = [];
    let i = 0;
    while (i < lines.length) {
        let text = lines[i];
        const originalLine = i;
        while (text.trimEnd().endsWith('`') && i + 1 < lines.length) {
            // Remove backtick, join with next line
            text = text.trimEnd().slice(0, -1) + ' ' + lines[++i].trimStart();
        }
        result.push({ text, originalLine });
        i++;
    }
    return result;
}

/**
 * Attempts to parse a single logical line as a psake Task declaration.
 * Returns null if the line is not a task declaration.
 */
function parseTaskLine(line: string, lineIndex: number): PsakeTaskInfo | null {
    // Detect "Task" keyword at the start of the statement.
    // Allow optional "function" prefix and optional pipeline operator.
    // Pattern: Task [-Name] <name> [-Depends <deps>] [-Description <desc>] ...
    const taskPattern = /^(?:function\s+)?Task\s+/i;
    if (!taskPattern.test(line)) {
        return null;
    }

    // Strip the leading "Task " keyword
    const rest = line.replace(/^(?:function\s+)?Task\s+/i, '').trim();

    // Extract name (may be positional or -Name <name>)
    const name = extractName(rest);
    if (!name) {
        return null;
    }

    const dependencies = extractDepends(rest);
    const description = extractDescription(rest);
    const fromModule = extractFromModule(rest) ?? undefined;
    const requiredVersion = (extractVersionParam(rest, 'RequiredVersion') ?? extractVersionParam(rest, 'Version')) ?? undefined;
    const minimumVersion = extractVersionParam(rest, 'MinimumVersion') ?? undefined;
    const maximumVersion = extractVersionParam(rest, 'MaximumVersion') ?? undefined;
    const lessThanVersion = extractVersionParam(rest, 'LessThanVersion') ?? undefined;

    return { name, dependencies, description, line: lineIndex, fromModule, requiredVersion, minimumVersion, maximumVersion, lessThanVersion };
}

/** Matches a possibly-quoted identifier */
const IDENTIFIER = /^["']?([A-Za-z0-9_.\-]+)["']?/;

function extractName(rest: string): string | null {
    // Explicit: -Name <name>
    const namedMatch = rest.match(/-Name\s+["']?([A-Za-z0-9_.\-]+)["']?/i);
    if (namedMatch) {
        return namedMatch[1];
    }

    // Positional: the first token that is not a switch/parameter
    if (rest.startsWith('-')) {
        return null;
    }
    const positional = rest.match(IDENTIFIER);
    return positional ? positional[1] : null;
}

function extractDepends(rest: string): string[] {
    // -Depends can take a comma-separated list or a PowerShell array @(a, b, c)
    const match = rest.match(/-Depends\s+(@\()?([A-Za-z0-9_.,\s"'\-]+?)(\))?\s*(?:-|{|$)/i);
    if (!match) {
        return [];
    }
    const raw = match[2];
    return raw
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
}

function extractDescription(rest: string): string {
    // -Description "some text" or -Description 'some text'
    const match = rest.match(/-Description\s+["']([^"']*)["']/i);
    return match ? match[1] : '';
}

function extractFromModule(rest: string): string | null {
    // -FromModule ModuleName  or  -FromModule 'ModuleName'  or  -FromModule "ModuleName"
    const match = rest.match(/-FromModule\s+["']?([A-Za-z0-9_.\-]+)["']?/i);
    return match ? match[1] : null;
}

function extractVersionParam(rest: string, paramName: string): string | null {
    // Handles -MinimumVersion '1.2.3', -RequiredVersion "1.2.3", -Version 1.2.3, etc.
    const escaped = paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = rest.match(new RegExp(`-${escaped}\\s+["']?([\\w.]+)["']?`, 'i'));
    return match ? match[1] : null;
}
