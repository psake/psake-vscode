import * as path from 'path';
import * as vscode from 'vscode';
import { parsePsakeFile, PsakeTaskInfo } from './psakeParser.js';
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
      return parsePsakeFile(content);
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
      `| Select-Object -Property ModuleBase, @{N='Version';E={$_.Version.ToString()}}`,
      `| ConvertTo-Json -Compress`,
    ].join(' ');

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
