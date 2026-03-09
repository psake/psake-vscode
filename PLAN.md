# psake-vscode Modernization Plan

## Overview

Full modernization of the psake VS Code extension from its 2017 state to a modern 2026 extension, including a Task Provider that parses psakefile.ps1 to discover tasks, a sidebar Tree View, updated dependencies, bundled output, and tests.

**Target**: VS Code `^1.90.0` | **TypeScript**: `~5.5` | **Bundler**: esbuild

---

## Phase 1: Foundation — Modernize Tooling & Dependencies

### 1.1 Replace deprecated `vscode` npm package
- Remove `vscode` from devDependencies
- Add `@types/vscode` (matching engine `^1.90.0`) as devDependency
- Add `@vscode/test-electron` for integration testing
- Remove the `postinstall` script (`node ./node_modules/vscode/bin/install` — no longer needed)

### 1.2 Update all dependencies
- TypeScript `2.5.3` → `~5.5`
- `@types/node` `^6` → `^20` (match VS Code's bundled Node)
- `@types/mocha` `^2` → `^10`
- `mocha` `^2` → `^10`
- Add `@vscode/vsce` for packaging

### 1.3 Add esbuild bundler
- Add `esbuild` as devDependency
- Create `esbuild.mjs` build script that bundles `src/psakeMain.ts` → `dist/extension.js` (single file, external `vscode`)
- Update `package.json`:
  - `"main": "./dist/extension.js"`
  - Scripts: `build`, `watch`, `package`, `vscode:prepublish`
- Update `tsconfig.json`: target `ES2022`, module `Node16`, moduleResolution `Node16`, outDir `./dist`

### 1.4 Add `.vscodeignore`
```
.vscode/
src/
out/
node_modules/
.gitignore
.github/
tsconfig.json
esbuild.mjs
**/*.map
```

### 1.5 Update `.vscode/` workspace configs
- Update `launch.json` to use new `dist/` output path, remove the dead Go debug config
- Update `tasks.json` to use new build scripts
- Update `settings.json` to hide `dist/` in explorer

---

## Phase 2: Fix Deprecated APIs & Restructure Source

### 2.1 Replace `workspace.rootPath`
- `workspace.rootPath` (deprecated since 1.37) → `workspace.workspaceFolders`
- Support multi-root workspaces: scan all workspace folders for psakefile.ps1

### 2.2 Replace `fs` with `vscode.workspace.fs`
- Replace `fs.createWriteStream` and `fs.existsSync` with the VS Code `workspace.fs` API (`readFile`, `writeFile`, `stat`)
- This enables proper support for virtual/remote file systems

### 2.3 Restructure source layout
```
src/
├── extension.ts              # Entry point (activate/deactivate)
├── taskProvider.ts           # PsakeTaskProvider (TaskProvider impl)
├── psakeParser.ts            # Parse psakefile.ps1 → task definitions
├── treeView.ts               # PsakeTreeDataProvider (Tree View)
├── scaffoldCommand.ts        # Existing "install build file" command, cleaned up
├── constants.ts              # Shared constants
└── log.ts                    # Logger (simplified)
```

### 2.4 Implement proper `deactivate()`
- Add `deactivate()` export that disposes of file watchers, task provider registration, etc.
- Use a `disposables` array pushed to `context.subscriptions`

---

## Phase 3: Psake File Parser

### 3.1 Implement `psakeParser.ts`
Parse PowerShell `psakefile.ps1` files to extract psake task definitions. Psake tasks follow the pattern:

```powershell
Task -Name <name> [-Depends <dep1>, <dep2>] [-Description "<desc>"] [-Action { ... }]
# or positional: Task <name> ...
```

The parser should extract:
- **Task name** (required)
- **Dependencies** (optional `-Depends` parameter, comma-separated)
- **Description** (optional `-Description` parameter, string literal)
- **Line number** for go-to-definition support

Implementation approach:
- Use regex-based parsing (no need for a full PowerShell AST)
- Handle common patterns: single-line tasks, multi-line tasks with backtick continuation
- Handle both `-Name TaskName` and positional `Task TaskName` syntax
- Return `PsakeTaskInfo[]` where each entry has `{ name, dependencies, description, line }`

### 3.2 File discovery
- Search for `psakefile.ps1` (case-insensitive) in workspace roots
- Also support custom file names via a setting (see Phase 6)
- Use `vscode.workspace.findFiles()` with glob pattern

---

## Phase 4: Task Provider

### 4.1 Define task type in `package.json`
```json
"taskDefinitions": [
  {
    "type": "psake",
    "required": ["task"],
    "properties": {
      "task": {
        "type": "string",
        "description": "The psake task name to execute"
      },
      "file": {
        "type": "string",
        "description": "Path to the psake build file (default: psakefile.ps1)"
      }
    }
  }
]
```

### 4.2 Implement `PsakeTaskProvider`
- Implements `vscode.TaskProvider`
- **`provideTasks()`**: Finds all psakefile.ps1 files in the workspace, parses them, returns a `vscode.Task` for each discovered task
- **`resolveTask(task)`**: Resolves a task from tasks.json by filling in the execution details
- Each task uses `ShellExecution` to run: `Invoke-psake -buildFile <file> -taskList <taskName>`
- Task source: `"psake"`
- Task group: `vscode.TaskGroup.Build` for the `default` task, undefined for others
- Task scope: the `WorkspaceFolder` containing the psakefile

### 4.3 Register and lifecycle
- Register via `vscode.tasks.registerTaskProvider('psake', provider)` in `activate()`
- Set up a `FileSystemWatcher` on `**/psakefile.ps1` to invalidate cached tasks on file changes
- Push disposables to `context.subscriptions`

### 4.4 Activation events
Update `activationEvents` in package.json:
- `workspaceContains:**/psakefile.ps1` — activate when a workspace has a psake file
- `onCommand:psake.buildFile` — existing command
- Remove explicit activation events that VS Code can infer from contributes

---

## Phase 5: Tree View

### 5.1 Register Tree View in `package.json`
```json
"views": {
  "explorer": [
    {
      "id": "psakeTasksView",
      "name": "psake Tasks",
      "when": "psake:hasTaskFile",
      "icon": "images/psake.png"
    }
  ]
}
```

### 5.2 Implement `PsakeTreeDataProvider`
- Implements `vscode.TreeDataProvider<PsakeTreeItem>`
- Top-level items: psakefile.ps1 files found in workspace (if multi-root, one per folder)
- Child items: individual tasks parsed from each file
- Each task item shows:
  - Label: task name
  - Description: task description (from `-Description` param) or dependencies list
  - Context value for right-click menus
  - Inline "Run" button via view/item/context menus
- Refresh when file watcher fires (reuse the same watcher from Task Provider)

### 5.3 Tree View commands
- `psake.runTask` — Run a specific task (used by inline run button)
- `psake.openTaskDefinition` — Navigate to task line in psakefile.ps1 (click action)
- `psake.refreshTasks` — Manual refresh button in view title

### 5.4 Context value and menus
```json
"menus": {
  "view/title": [
    { "command": "psake.refreshTasks", "when": "view == psakeTasksView", "group": "navigation" }
  ],
  "view/item/context": [
    { "command": "psake.runTask", "when": "viewItem == psakeTask", "group": "inline" }
  ]
}
```

---

## Phase 6: Extension Settings

Add configuration options in `package.json` contributes.configuration:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `psake.buildFile` | `string` | `"psakefile.ps1"` | Default build file name |
| `psake.taskProvider.enabled` | `boolean` | `true` | Enable/disable auto task detection |

---

## Phase 7: Improve Existing Features

### 7.1 Update snippets
- Review and update `snippets/powershell.json` with more modern psake patterns
- Add snippets for: `Properties`, `Framework`, `Include`, `TaskSetup`, `TaskTearDown`, `FormatTaskName`

### 7.2 Modernize scaffold command
- Use `workspace.fs` API instead of raw `fs`
- Support multi-root workspaces (prompt which folder if multiple)
- Update the template content to match modern psake conventions

---

## Phase 8: Tests

### 8.1 Unit tests for the parser
- Test file: `src/test/psakeParser.test.ts`
- Test cases:
  - Simple `Task TaskName { }`
  - Task with `-Name`, `-Depends`, `-Description`, `-Action`
  - Multi-line tasks with backtick continuation
  - Multiple tasks in one file
  - Edge cases: comments, strings containing "Task", nested scriptblocks

### 8.2 Unit tests for Task Provider
- Mock `workspace.findFiles` and file contents
- Verify correct tasks are returned with proper execution commands

### 8.3 Test infrastructure
- Use `@vscode/test-electron` for integration tests
- Use mocha as the test runner
- Add npm script: `"test": "node ./dist/test/runTest.js"`

---

## Phase 9: Packaging & Documentation

### 9.1 Update README.md
- Add feature sections: Task Provider, Tree View, snippets, scaffold
- Add screenshots/GIFs for new features
- Add configuration reference table
- Add requirements section (PowerShell extension, psake)

### 9.2 Add CHANGELOG.md
- Document v0.2.0 (or v1.0.0) changes

### 9.3 Update package.json metadata
- Bump version to `1.0.0` (this is a major rewrite)
- Verify `icon`, `repository`, `bugs` fields
- Add `sponsor` field if applicable
- Update `categories` to include `["Languages", "Snippets", "Other"]`

---

## Implementation Order

Phases should be implemented in this order due to dependencies:

```
Phase 1 (Foundation)
  → Phase 2 (API fixes & restructure)
    → Phase 3 (Parser)               ← core dependency for Phase 4 & 5
      → Phase 4 (Task Provider)      ← depends on parser
      → Phase 5 (Tree View)          ← depends on parser, can parallel with 4
    → Phase 6 (Settings)             ← wire into provider & tree view
    → Phase 7 (Existing features)    ← independent, can parallel
  → Phase 8 (Tests)                  ← after features are implemented
  → Phase 9 (Packaging & docs)       ← final
```

**Estimated file changes**: ~10 files modified, ~8 files created, ~3 files deleted

---

## Key Technical Decisions

1. **esbuild over webpack**: Simpler config, faster builds, sufficient for this extension's needs
2. **Regex parser over PowerShell AST**: Avoids requiring a PowerShell runtime for parsing; psake task declarations are syntactically simple enough for regex
3. **ShellExecution over ProcessExecution**: psake is invoked via PowerShell, so shell execution is the natural fit
4. **Single file watcher shared between Task Provider and Tree View**: Avoids duplicate watches, uses an event emitter pattern to notify both consumers
5. **No webview**: Tree View is sufficient for the task list UI; keeps the extension lightweight
