# Changelog

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
