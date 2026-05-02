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
    /**
     * Set when the task was discovered from an `Include`-d file rather than the
     * main psakefile.  Holds the path as written in the Include statement
     * (relative or absolute), used for display purposes.
     */
    includedFrom?: string;
    /**
     * Absolute file-system path to the file where this task is defined.
     * Populated for tasks from modules and Include files so that the
     * "Go to Task Definition" command opens the correct source file.
     * Undefined for tasks declared directly in the main psakefile.
     */
    sourceFilePath?: string;
}

/**
 * Represents an `Include` statement found in a psakefile.
 */
export interface PsakeIncludeInfo {
    /** The path as written in the Include statement (may be relative or absolute). */
    path: string;
    /** True when the -LiteralPath parameter was used. */
    isLiteral: boolean;
    /** Zero-based line number of the Include statement. */
    line: number;
}

/**
 * Parses a psakefile.ps1 and extracts all Task definitions.
 *
 * Handles these common patterns:
 *
 *   Task default -Depends Test, Build
 *   Task -Name Build -Depends Clean -Description "Compiles the project" { ... }
 *   Task "Release" -Depends @(Build, Test) -Action { ... }
 *
 * Also handles the psake v5 declarative hashtable syntax:
 *
 *   Task 'Build' @{ DependsOn = 'Clean'; Description = 'Compiles the project'; Action = { ... } }
 */
export function parsePsakeFile(content: string): PsakeTaskInfo[] {
    const tasks: PsakeTaskInfo[] = [];
    const lines = content.split(/\r?\n/);

    // Join continuation lines (trailing backtick `) so multi-line declarations
    // can be matched by a single-line regex pass.
    const joined = joinContinuationLines(lines);

    // Join multi-line @{ } hashtable blocks (psake v5 declarative syntax) so
    // that they too can be matched by a single-line regex pass.
    const expanded = joinHashtableBlocks(joined);

    for (let i = 0; i < expanded.length; i++) {
        const { text, originalLine } = expanded[i];

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

/**
 * Returns the net number of `{` minus `}` characters in a text fragment.
 * Used to track open/close brace depth when joining multi-line hashtable blocks.
 */
function netBraceCount(text: string): number {
    let count = 0;
    for (const ch of text) {
        if (ch === '{') { count++; }
        else if (ch === '}') { count--; }
    }
    return count;
}

/**
 * Joins lines that form a multi-line `@{ }` hashtable block following a Task
 * keyword into a single logical line.  This allows the single-line regex
 * matchers to work on the psake v5 declarative syntax:
 *
 *   Task 'Build' @{
 *       DependsOn   = 'Clean'
 *       Description = 'Compiles the project'
 *       Action      = { ... }
 *   }
 *
 * Lines that are already self-contained (the `@{` and its matching `}` appear
 * on the same line) are passed through unchanged.
 */
function joinHashtableBlocks(lines: JoinedLine[]): JoinedLine[] {
    const result: JoinedLine[] = [];
    let i = 0;
    while (i < lines.length) {
        const current = lines[i];
        const trimmed = current.text.trimStart();

        // Only process Task declarations that open a hashtable block
        if (/^(?:function\s+)?Task\s+/i.test(trimmed) && /@\{/.test(current.text)) {
            let accumulated = current.text;
            let braceDepth = netBraceCount(current.text);
            i++;
            // Keep joining subsequent lines until all braces are balanced
            while (i < lines.length && braceDepth > 0) {
                const next = lines[i];
                accumulated += ' ' + next.text.trim();
                braceDepth += netBraceCount(next.text);
                i++;
            }
            result.push({ text: accumulated, originalLine: current.originalLine });
        } else {
            result.push(current);
            i++;
        }
    }
    return result;
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

    // Detect psake v5 declarative hashtable syntax: Task 'Name' @{ ... }
    const hasHashtable = /@\{/.test(rest);

    let dependencies: string[];
    let description: string;

    if (hasHashtable) {
        // Extract the content between the outermost @{ and its matching }
        const htMatch = rest.match(/@\{([\s\S]*)\}/);
        const htContent = htMatch ? htMatch[1] : '';
        dependencies = extractHashtableDepends(htContent);
        description = extractHashtableDescription(htContent);
    } else {
        dependencies = extractDepends(rest);
        description = extractDescription(rest);
    }

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

/**
 * Extracts the `Description` value from a psake v5 declarative hashtable body.
 * Handles:  Description = 'some text'  or  Description = "some text"
 * Uses a backreference to ensure the closing quote matches the opening quote,
 * which correctly handles descriptions that contain the other quote character
 * (e.g. Description = "It's working").
 */
function extractHashtableDescription(htContent: string): string {
    const match = htContent.match(/\bDescription\s*=\s*(['"])(.*?)\1/i);
    return match ? match[2] : '';
}

/**
 * Extracts the `DependsOn` value(s) from a psake v5 declarative hashtable body.
 * Handles these forms:
 *   DependsOn = 'Clean'
 *   DependsOn = @('Clean', 'Build')
 *   DependsOn = 'Clean', 'Build'
 *   DependsOn = Clean          (unquoted)
 */
function extractHashtableDepends(htContent: string): string[] {
    // 1. Try @( ... ) array literal first
    const arrayMatch = htContent.match(/\bDependsOn\s*=\s*@\(([^)]*)\)/i);
    if (arrayMatch) {
        return arrayMatch[1]
            .split(',')
            .map(s => s.trim().replace(/^(['"])(.*)\1$/, '$2'))
            .filter(Boolean);
    }

    // 2. Scalar or comma-separated values.
    // Use a non-greedy match that stops at the next hashtable key ( word = ),
    // a semicolon, a closing brace, or end-of-string.
    const match = htContent.match(/\bDependsOn\s*=\s*(.*?)(?=\s*[;}\n]|\s+\w+\s*=|$)/i);
    if (match && match[1].trim()) {
        return match[1]
            .split(',')
            .map(s => s.trim().replace(/^(['"])(.*)\1$/, '$2'))
            .filter(Boolean);
    }

    return [];
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

// ---------------------------------------------------------------------------
// Include parsing
// ---------------------------------------------------------------------------

/**
 * Parses all `Include` statements from a psakefile.
 *
 * Handles these forms (all case-insensitive, with or without quotes):
 *
 *   Include './helpers.ps1'
 *   Include -Path './helpers.ps1'
 *   Include -fileNamePathToInclude './helpers.ps1'
 *   Include -LiteralPath './helpers.ps1'
 */
export function parseIncludes(content: string): PsakeIncludeInfo[] {
    const result: PsakeIncludeInfo[] = [];
    const lines = content.split(/\r?\n/);
    const joined = joinContinuationLines(lines);

    for (const { text, originalLine } of joined) {
        const trimmed = text.trimStart();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const info = parseIncludeLine(trimmed, originalLine);
        if (info) {
            result.push(info);
        }
    }

    return result;
}

function parseIncludeLine(line: string, lineIndex: number): PsakeIncludeInfo | null {
    if (!/^Include\s+/i.test(line)) {
        return null;
    }
    const rest = line.replace(/^Include\s+/i, '').trim();

    // -LiteralPath
    const literalMatch = rest.match(/^-LiteralPath\s+["']?([^"'\s]+)["']?/i);
    if (literalMatch) {
        return { path: literalMatch[1], isLiteral: true, line: lineIndex };
    }

    // -Path or -fileNamePathToInclude (named parameter)
    const namedMatch = rest.match(/^-(?:Path|fileNamePathToInclude)\s+["']?([^"'\s]+)["']?/i);
    if (namedMatch) {
        return { path: namedMatch[1], isLiteral: false, line: lineIndex };
    }

    // Positional: must not start with '-' (that would be an unknown param)
    if (!rest.startsWith('-')) {
        const posMatch = rest.match(/^["']?([^"'\s]+)["']?/);
        if (posMatch) {
            return { path: posMatch[1], isLiteral: false, line: lineIndex };
        }
    }

    return null;
}
