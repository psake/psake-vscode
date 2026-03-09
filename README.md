# psake for VS Code

Language support, task integration, and snippets for [psake](https://github.com/psake/psake) — a PowerShell build automation tool.

> **Requirements:** The [PowerShell extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.PowerShell) must be installed.

---

## Features

### Task Provider

The extension automatically detects tasks defined in your `psakefile.ps1` and surfaces them in VS Code's built-in task system.

- Open the **Command Palette** → **Tasks: Run Task** → select any discovered psake task
- Tasks are discovered from all workspace folders
- The `default` task is automatically placed in the **Build** task group (accessible via **Ctrl+Shift+B**)
- Tasks update automatically when you save changes to `psakefile.ps1`

You can also reference psake tasks in your `tasks.json`:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "psake",
            "task": "Build",
            "file": "psakefile.ps1"
        }
    ]
}
```

### Build Script Support

Most psake projects use a wrapper script (typically `build.ps1`) as the entry point. The extension auto-detects `build.ps1` in the workspace root and runs tasks through it instead of calling `Invoke-psake` directly:

```
.\build.ps1 -Task Build
```

The parameter name defaults to `-Task` but is configurable via `psake.buildScriptTaskParameter`. Additional parameters can be appended to every build script call via `psake.buildScriptParameters` (e.g., `-Configuration Release`). If your project uses a different wrapper script path, set `psake.buildScript`. To disable build script detection and always call `Invoke-psake` directly, set `psake.buildScript` to `"none"`.

### psake Tasks Explorer

A **psake Tasks** panel appears in the Explorer sidebar when a `psakefile.ps1` is found in your workspace. It shows all tasks with their descriptions and dependencies. Clicking a task navigates to its definition in the file; the inline play button runs the task.

### CodeLens — Run Task from the Editor

Each `Task` declaration in your `psakefile.ps1` displays a **▶ Run Task** action above it. Click it to execute that task immediately without leaving the editor.

### tasks.json IntelliSense

When editing `.vscode/tasks.json`, the extension provides autocomplete suggestions for the `"task"` property inside `"type": "psake"` task definitions. The suggestions are dynamically populated from the task names discovered in your psakefile(s).

### Sync Tasks to tasks.json

The **psake: Sync Tasks to tasks.json** command (Command Palette) scans your workspace for psake tasks and adds them to `.vscode/tasks.json`. Existing entries are preserved so any customizations (such as `problemMatcher` or `group`) are not overwritten.

### Scaffold Build File

The **psake: Install sample build file** command (Command Palette) creates a starter `psakefile.ps1` in your workspace with four sample tasks (`default`, `Test`, `Compile`, `Clean`).

### Snippets

Type `psake` + `Ctrl+Space` in a PowerShell file to access the following snippets:

| Prefix | Description |
|--------|-------------|
| `psakeTask` | Minimal task with inline action block |
| `psakeTaskFull` | Task with `-Depends` and `-Description` |
| `psakeTaskDependsOnly` | Task that only declares dependencies |
| `psakeProperties` | Properties block for shared build variables |
| `psakeInclude` | Include another PowerShell script |
| `psakeFramework` | Set the .NET framework version for MSBuild |
| `psakeFormatTaskName` | Customize task name display output |
| `psakeTaskSetup` | Block that runs before each task |
| `psakeTaskTearDown` | Block that runs after each task |

---

## Commands

| Command | Description |
|---------|-------------|
| **psake: Install sample build file** | Scaffold a starter `psakefile.ps1` |
| **psake: Sync Tasks to tasks.json** | Add discovered psake tasks to `.vscode/tasks.json` |
| **psake: Refresh Tasks** | Re-scan the build file and update the task tree |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `psake.buildFile` | `psakefile.ps1` | Default build file name used for scaffolding and task discovery |
| `psake.taskProvider.enabled` | `true` | Enable or disable automatic task detection |
| `psake.codeLens.enabled` | `true` | Show **▶ Run Task** CodeLens above each task declaration in the build file |
| `psake.buildScript` | `""` (auto-detect) | Path to a wrapper build script (e.g., `build.ps1`). When empty, auto-detects `build.ps1` in the workspace root. Set to `"none"` to always use `Invoke-psake` directly. |
| `psake.buildScriptTaskParameter` | `Task` | The parameter name on the build script that accepts the task name |
| `psake.buildScriptParameters` | `""` | Extra parameters appended to the build script call when a wrapper is used (e.g., `-Configuration Release -Clean`) |
| `psake.invokeParameters` | `""` | Extra parameters appended to the `Invoke-psake` call when no wrapper is used (e.g., `-nologo -properties @{Configuration='Release'}`) |
| `psake.powershellExecutable` | `""` (auto-detect) | PowerShell executable to use (e.g., `pwsh`, `powershell`, or a full path). When empty, auto-detects `pwsh` then `powershell`. |
| `psake.shellArgs` | `["-NoProfile"]` | Arguments passed to the PowerShell executable before `-Command` (e.g., add `"-ExecutionPolicy", "Bypass"` for restricted environments) |

---

## Contribution

Issues and pull requests are welcome on [GitHub](https://github.com/psake/psake-vscode/issues).

## Releases

See the [releases](https://github.com/psake/psake-vscode/releases) page for version history.
