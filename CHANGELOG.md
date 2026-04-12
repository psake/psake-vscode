# Changelog

## [Unreleased]

## [1.5.0] - 2026-04-12

### Added

- **Build/Test classification for psake tasks**: auto-detected tasks whose
  names match patterns like `test`/`pester`/`spec` are placed in the Test
  group and get the `$pester` problem matcher appended; names matching
  `build`/`compile`/`publish`/`package`/`release`/`dist` are placed in the
  Build group. This makes "Run Test Task" and "Run Build Task" work without
  any configuration
- The "Sync Tasks" command uses the same classifier to pre-select tasks and
  prompts for confirmation before writing `tasks.json`, so persisted entries
  reflect user intent rather than pure heuristic
- New setting `psake.classifyByName` (default: `true`) controls both
  behaviors. Disable to skip classification entirely

### Changed

- Gallery banner color updated to `#1c1e21` for better contrast on the
  Marketplace listing

## [1.4.0] 2026-04-12

### Added

- **Problem matchers for psake v5**: two new named problem matchers surface
  errors and warnings in the VS Code Problems panel with clickable
  file/line/column navigation
  - `$psake`: parses GitHub Actions-compatible annotation lines emitted by
    psake v5's `Annotated` output format
  - `$psake-powershell`: fallback matcher for raw PowerShell error output
    (e.g. syntax errors before the build plan compiles)
- **Automatic activation**: the task provider auto-attaches both matchers and
  sets `PSAKE_OUTPUT_FORMAT=Annotated` in the shell environment so the mode
  works through wrapper scripts without parameter forwarding
- **New setting** `psake.problemMatcher.enabled` (default: `true`): controls
  problem matcher attachment and environment variable injection. Set to `false`
  to disable without affecting the rest of the task provider
- The "Sync Tasks" command now includes `problemMatcher` on newly created
  `tasks.json` entries

### Notes

- Requires psake v5 (alpha) with `Annotated` output format support for the
  `$psake` matcher to produce results. The `$psake-powershell` matcher works
  independently

## [1.2.0] 2026-04-06

### Added

- **Per-directory build script resolution**: each psakefile now uses a co-located
  `build.ps1` if one exists in its directory, instead of always using the
  workspace root's build script. Supports monorepo layouts where subdirectories
  have their own `psakefile.ps1` + `build.ps1` pairs
- Tasks now run with `cwd` set to the psakefile's directory, so relative paths
  in build scripts resolve correctly

### Changed

- `psake.buildScript` explicit config is now resolved to an absolute path so it
  works regardless of the task's working directory
- Build script auto-detection searches the psakefile's directory instead of only
  the workspace root

## [1.1.0] 2026-03-14

### Added

- **Module task resolution (`-FromModule`)**: tasks can now reference other
  psake modules with version constraints (MinimumVersion, MaximumVersion,
  RequiredVersion, LessThanVersion). Module tasks are resolved to show
  dependencies and descriptions in the tree view and jump-to-definition
  navigates to the module's psakeFile.ps1
- **Include file support**: tasks from files included via `Include` statements
  (with `-Path`, `-LiteralPath`, or `-fileNamePathToInclude` parameters) are
  now discovered and displayed in the tree view, task provider, and code lens
- **Full task expansion**: all tasks exported by referenced modules become
  available to the build, appearing in task lists and completions
- **Source file tracking**: tasks from modules or include files retain their
  source file path for accurate navigation and visual distinction
- **New snippet**: `psakeTaskFromModule` for quickly authoring module reference
  tasks with version constraints

### Changed

- Parser now extracts `-FromModule` parameter and version constraints
- Tree view, task provider, and completions now show module and include task
  origins via icons and metadata
- Task definition interface now tracks module/include source and resolved state

### Fixed

- Version constraint comparison logic matches psake's Test-ModuleVersion
  semantics exactly (minimum ≥, maximum ≤, less-than <, required ==)

## [1.0.2] 2026-03-13

### Fixed

- **Case-insensitive file detection**: extension now finds `psakefile.ps1` and `build.ps1` regardless of casing (e.g., `psakeFile.ps1`, `Build.ps1`, `BUILD.ps1`)
- Updated activation events to include common case variations of psake and build files

## [1.0.1] 2026-03-09

### Added

- **New settings for task execution customization**:
  - `psake.codeLens.enabled`: toggle CodeLens hints on/off (default: `true`)
  - `psake.powershellExecutable`: override PowerShell executable (auto-detects by default)
  - `psake.shellArgs`: customize shell arguments passed to PowerShell (default: `["-NoProfile"]`)
  - `psake.invokeParameters`: append extra parameters to `Invoke-psake` calls
  - `psake.buildScriptParameters`: append extra parameters to build script wrapper calls
- Settings now support dynamic configuration updates without restarting VS Code
- CodeLens provider now respects the `psake.codeLens.enabled` setting

## [1.0.0]

### Added

- **Task Provider**: automatically detects psake tasks from `psakefile.ps1` and surfaces them in VS Code's Tasks UI (`Tasks: Run Task`, `Ctrl+Shift+B`)
- **psake Tasks Explorer**: sidebar tree view showing all discovered tasks with descriptions, dependencies, and inline run buttons
- **Go to Task Definition**: clicking a task in the explorer navigates to its line in the build file
- **Multi-root workspace support**: task detection works across all open workspace folders
- **File watcher**: tasks refresh automatically when `psakefile.ps1` is saved
- **New snippets**: `psakeTaskFull`, `psakeTaskDependsOnly`, `psakeProperties`, `psakeInclude`, `psakeFramework`, `psakeFormatTaskName`, `psakeTaskSetup`, `psakeTaskTearDown`
- **Settings**: `psake.buildFile` and `psake.taskProvider.enabled` configuration options
- **Unit tests** for the psake file parser

### Changed

- Minimum VS Code version raised to `^1.90.0`
- Scaffold command now supports multi-root workspaces and uses the VS Code file system API
- Extension now activates automatically when a `psakefile.ps1` is present (`workspaceContains`)
- Updated all dependencies (TypeScript 5.5, modern `@types/vscode`, esbuild bundler)

### Fixed

- Replaced deprecated `workspace.rootPath` with `workspace.workspaceFolders`
- Replaced Node.js `fs` calls with `vscode.workspace.fs` for virtual/remote file system support

## [0.1.0]

- Initial release with 2 PowerShell snippets and a scaffold command
