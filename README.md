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

### psake Tasks Explorer

A **psake Tasks** panel appears in the Explorer sidebar when a `psakefile.ps1` is found in your workspace. It shows all tasks with their descriptions and dependencies. Clicking a task navigates to its definition in the file; the inline play button runs the task.

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

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `psake.buildFile` | `psakefile.ps1` | Default build file name used for scaffolding and task discovery |
| `psake.taskProvider.enabled` | `true` | Enable or disable automatic task detection |

---

## Contribution

Issues and pull requests are welcome on [GitHub](https://github.com/psake/psake-vscode/issues).

## Releases

See the [releases](https://github.com/psake/psake-vscode/releases) page for version history.
