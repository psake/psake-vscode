import * as path from 'path';
import * as vscode from 'vscode';
import { parsePsakeFile, parseIncludes, PsakeTaskInfo, PsakeIncludeInfo } from './psakeParser.js';
import { detectPowerShellExecutable, runPowerShellScript } from './powershellUtils.js';
import { logError } from './log.js';

// ---------------------------------------------------------------------------
// Version constraint types and helpers
// ---------------------------------------------------------------------------

export interface VersionConstraints {
  requiredVersion?: string;
  minimumVersion?: string;
  maximumVersion?: string;
  lessThanVersion?: string;
}

/** Splits a version string into a numeric segment array for comparison. */
function parseVersion(version: string): number[] {
  return version.split('.').map(n => parseInt(n, 10) || 0);
}

/** Returns negative / zero / positive like a standard comparator. */
function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Replicates psake's Test-ModuleVersion semantics:
 *   requiredVersion  → exact match (sets both min and max internally in psake)
 *   minimumVersion   → version >= minimumVersion  (inclusive)
 *   maximumVersion   → version <= maximumVersion  (inclusive)
 *   lessThanVersion  → version <  lessThanVersion (exclusive)
 *
 * When no constraints are supplied, any version matches.
 */
export function matchesVersionConstraints(version: string, constraints: VersionConstraints): boolean {
  const { requiredVersion, minimumVersion, maximumVersion, lessThanVersion } = constraints;

  if (!requiredVersion && !minimumVersion && !maximumVersion && !lessThanVersion) {
    return true;
  }

  if (requiredVersion) {
    return compareVersions(version, requiredVersion) === 0;
  }
  if (minimumVersion && compareVersions(version, minimumVersion) < 0) {
    return false;
  }
  if (maximumVersion && compareVersions(version, maximumVersion) > 0) {
    return false;
  }
  if (lessThanVersion && compareVersions(version, lessThanVersion) >= 0) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

interface ModuleInfo {
  ModuleBase: string;
  Version: string;
}

function cacheKey(moduleName: string, constraints: VersionConstraints): string {
  return [
    moduleName,
    constraints.requiredVersion ?? '',
    constraints.minimumVersion ?? '',
    constraints.maximumVersion ?? '',
    constraints.lessThanVersion ?? '',
  ].join('|');
}

export class PsakeModuleResolver {
  private readonly cache = new Map<string, PsakeTaskInfo[]>();

  /** Clears all cached resolutions (call on explicit user refresh). */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Resolves all tasks from the named psake module that satisfy the given
   * version constraints.  Results are cached by (moduleName, constraints).
   *
   * Returns an empty array when the module cannot be found, when no version
   * satisfies the constraints, or when the module has no psakeFile.ps1.
   */
  async resolveModuleTasks(moduleName: string, constraints: VersionConstraints): Promise<PsakeTaskInfo[]> {
    const key = cacheKey(moduleName, constraints);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const result = await this.doResolve(moduleName, constraints);
    this.cache.set(key, result);
    return result;
  }

  private async doResolve(moduleName: string, constraints: VersionConstraints): Promise<PsakeTaskInfo[]> {
    let moduleBase: string | undefined;
    try {
      moduleBase = await this.findModuleBase(moduleName, constraints);
    } catch (err) {
      logError(err, false);
      return [];
    }

    if (!moduleBase) {
      return [];
    }

    const psakeFilePath = path.join(moduleBase, 'psakeFile.ps1');
    try {
      const uri = vscode.Uri.file(psakeFilePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(bytes).toString('utf8');
      const tasks = parsePsakeFile(content);
      // Stamp every task with the file it came from so callers can navigate to
      // the correct source (the module's psakeFile.ps1, not the main psakefile).
      for (const t of tasks) {
        t.sourceFilePath = psakeFilePath;
      }
      return tasks;
    } catch {
      // Module exists but has no psakeFile.ps1 — not a psake task module.
      return [];
    }
  }

  private async findModuleBase(moduleName: string, constraints: VersionConstraints): Promise<string | undefined> {
    const exe = await detectPowerShellExecutable();

    // Escape single-quotes in the module name to prevent injection.
    const safeName = moduleName.replace(/'/g, "''");
    const script = [
      `Get-Module -Name '${safeName}' -ListAvailable -ErrorAction SilentlyContinue`,
      `Select-Object -Property ModuleBase, @{N='Version';E={$_.Version.ToString()}}`,
      `ConvertTo-Json -Compress`,
    ].join(' | ');

    let output: string;
    try {
      output = await runPowerShellScript(exe, script);
    } catch (err) {
      logError(err, false);
      return undefined;
    }

    if (!output || output === 'null') {
      return undefined;
    }

    let modules: ModuleInfo[];
    try {
      const parsed: unknown = JSON.parse(output);
      // ConvertTo-Json returns an object (not array) when there is only one result.
      modules = Array.isArray(parsed) ? (parsed as ModuleInfo[]) : [parsed as ModuleInfo];
    } catch {
      return undefined;
    }

    // Filter by version constraints; pick the highest matching version.
    const matching = modules
      .filter(m => matchesVersionConstraints(m.Version, constraints))
      .sort((a, b) => compareVersions(b.Version, a.Version));

    return matching[0]?.ModuleBase;
  }
}

// ---------------------------------------------------------------------------
// Shared enrichment helper used by tree view, task provider, and completions
// ---------------------------------------------------------------------------

/**
 * Mutates each task in `tasks` that has a `-FromModule` parameter by:
 *  - setting `moduleResolved` to true/false
 *  - merging the module task's dependencies and description (when found)
 *
 * All unique module resolutions are performed in parallel.
 */
export async function enrichModuleTasks(tasks: PsakeTaskInfo[], resolver: PsakeModuleResolver): Promise<void> {
  const moduleItems = tasks.filter(t => !!t.fromModule);
  if (moduleItems.length === 0) {
    return;
  }

  await Promise.all(
    moduleItems.map(async info => {
      const constraints: VersionConstraints = {
        requiredVersion: info.requiredVersion,
        minimumVersion: info.minimumVersion,
        maximumVersion: info.maximumVersion,
        lessThanVersion: info.lessThanVersion,
      };

      const moduleTasks = await resolver.resolveModuleTasks(info.fromModule!, constraints);
      info.moduleResolved = moduleTasks.length > 0;

      if (info.moduleResolved) {
        const moduleTask = moduleTasks.find(
          t => t.name.toLowerCase() === info.name.toLowerCase()
        );
        if (moduleTask) {
          if (!info.description) {
            info.description = moduleTask.description;
          }
          // Merge deps: local deps (if any) plus the module task's deps.
          info.dependencies = [...new Set([...info.dependencies, ...moduleTask.dependencies])];
        }
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Include file resolution
// ---------------------------------------------------------------------------

/**
 * Reads every included file, parses its tasks, and stamps each task with
 * `includedFrom` (display path) and `sourceFilePath` (absolute path).
 */
async function resolveIncludedTasks(
  includes: PsakeIncludeInfo[],
  buildFileUri: vscode.Uri,
): Promise<PsakeTaskInfo[]> {
  const buildDir = path.dirname(buildFileUri.fsPath);
  const result: PsakeTaskInfo[] = [];

  for (const include of includes) {
    const absolutePath = path.isAbsolute(include.path)
      ? include.path
      : path.resolve(buildDir, include.path);

    try {
      const uri = vscode.Uri.file(absolutePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(bytes).toString('utf8');
      const tasks = parsePsakeFile(content);
      const displayPath = path.relative(buildDir, absolutePath).replace(/\\/g, '/');
      for (const t of tasks) {
        t.includedFrom = displayPath;
        t.sourceFilePath = absolutePath;
      }
      result.push(...tasks);
    } catch {
      // Include file not found or unreadable — skip silently.
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Full resolution: local + includes + module expansion
// ---------------------------------------------------------------------------

/**
 * The main resolution entry point used by the tree view, task provider, and
 * completion provider.
 *
 * Returns the full set of tasks visible to the build:
 *  1. Tasks declared directly in the psakefile (with module references enriched).
 *  2. Tasks from every `Include`-d file (deduplicated against local).
 *  3. All tasks exported by each loaded module that are NOT already declared
 *     locally — these become available in the psake build context because psake
 *     dot-sources the entire module psakeFile.ps1 (deduplicated against 1 & 2).
 *
 * Local declarations always win over included > module-expanded.
 */
export async function resolveAllTasks(
  content: string,
  buildFileUri: vscode.Uri,
  resolver?: PsakeModuleResolver,
): Promise<PsakeTaskInfo[]> {
  // 1. Parse the psakefile
  const localTasks = parsePsakeFile(content);
  const includes = parseIncludes(content);

  // 2. Enrich local module-reference tasks (sets moduleResolved, merges deps/description)
  if (resolver) {
    await enrichModuleTasks(localTasks, resolver);
  }

  // 3. Expand: add every task from each resolved module that isn't already
  //    declared locally (psake dot-sources the whole module psakeFile.ps1).
  const expandedModuleTasks: PsakeTaskInfo[] = [];
  if (resolver) {
    // Collect unique modules, preserving original casing from the first reference.
    const moduleRefs = new Map<string, { originalName: string; constraints: VersionConstraints }>();
    for (const task of localTasks) {
      if (task.fromModule && task.moduleResolved !== false) {
        const key = task.fromModule.toLowerCase();
        if (!moduleRefs.has(key)) {
          moduleRefs.set(key, {
            originalName: task.fromModule,
            constraints: {
              requiredVersion: task.requiredVersion,
              minimumVersion: task.minimumVersion,
              maximumVersion: task.maximumVersion,
              lessThanVersion: task.lessThanVersion,
            },
          });
        }
      }
    }

    const localNames = new Set(localTasks.map(t => t.name.toLowerCase()));
    for (const { originalName, constraints } of moduleRefs.values()) {
      // resolveModuleTasks is cached — this is a fast lookup after enrichModuleTasks.
      const moduleTasks = await resolver.resolveModuleTasks(originalName, constraints);
      for (const mt of moduleTasks) {
        if (!localNames.has(mt.name.toLowerCase())) {
          localNames.add(mt.name.toLowerCase());
          mt.fromModule = originalName;
          mt.moduleResolved = true;
          expandedModuleTasks.push(mt);
        }
      }
    }
  }

  // 4. Resolve included files
  const includedTasks = await resolveIncludedTasks(includes, buildFileUri);

  // 5. Deduplicate: local > included > module-expanded
  const seen = new Set(localTasks.map(t => t.name.toLowerCase()));

  const finalIncluded: PsakeTaskInfo[] = [];
  for (const t of includedTasks) {
    if (!seen.has(t.name.toLowerCase())) {
      seen.add(t.name.toLowerCase());
      finalIncluded.push(t);
    }
  }

  const finalModule: PsakeTaskInfo[] = [];
  for (const t of expandedModuleTasks) {
    if (!seen.has(t.name.toLowerCase())) {
      seen.add(t.name.toLowerCase());
      finalModule.push(t);
    }
  }

  return [...localTasks, ...finalIncluded, ...finalModule];
}
