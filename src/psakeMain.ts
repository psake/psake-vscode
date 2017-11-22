import * as vscode from 'vscode';
import { installBuildFileCommand } from './buildFile/psakeBuildFileCommand';
import * as fs from 'fs';
import * as os from 'os';

let taskProvider: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext): void {
    // Register the build file command.
    context.subscriptions.push(vscode.commands.registerCommand('psake.buildFile', async () => {
        installBuildFileCommand();
    }));

    function onConfigurationChanged() {
        let autoDetect = vscode.workspace.getConfiguration('psake').get('taskRunner.autoDetect');
        if (taskProvider && !autoDetect) {
            taskProvider.dispose();
            taskProvider = undefined;
        } else if (!taskProvider && autoDetect) {
            taskProvider = vscode.workspace.registerTaskProvider('psake', {
                provideTasks: async () => {
                    return await getpsakeScriptsAsTasks();
                },
                resolveTask(_task: vscode.Task): vscode.Task | undefined {
                    return undefined;
                }
            });
        }
    }

    vscode.workspace.onDidChangeConfiguration(onConfigurationChanged);
    onConfigurationChanged();
}

export function deactivate() {
    if (taskProvider) {
        taskProvider.dispose();
    }
}

interface psakeTaskDefinition extends vscode.TaskDefinition {
    script: string;
    file?: string;
}

async function getpsakeScriptsAsTasks(): Promise<vscode.Task[]> {
    let workspaceRoot = vscode.workspace.rootPath;
    let emptyTasks: vscode.Task[] = [];

    if (!workspaceRoot) {
        return emptyTasks;
    }

    try {
        let psakeConfig = vscode.workspace.getConfiguration('psake');
        let files = await vscode.workspace.findFiles(psakeConfig.taskRunner.scriptsIncludePattern, psakeConfig.taskRunner.scriptsExcludePattern);

        if (files.length === 0) {
            return emptyTasks;
        }

        const result: vscode.Task[] = [];

        files.forEach(file => {
            const contents = fs.readFileSync(file.fsPath).toString();

            let taskRegularExpression = new RegExp(psakeConfig.taskRunner.taskRegularExpression, "g");

            let matches, taskNames = [];

            while (matches = taskRegularExpression.exec(contents)) {
                taskNames.push(matches[1]);
            }

            taskNames.forEach(taskName => {
                const kind: psakeTaskDefinition = {
                    type: 'psake',
                    script: taskName
                };

                // TODO: Need to put something here
                let buildCommand = ``;

                if (os.platform() === "win32") {
                    // TODO: Need to put something here
                    buildCommand = ``;
                }

                const buildTask = new vscode.Task(kind, `Run ${taskName}`, 'psake', new vscode.ShellExecution(`${buildCommand}`), []);
                buildTask.group = vscode.TaskGroup.Build;

                result.push(buildTask);
            });
        });

        return result;
    } catch (e) {
        return [];
    }
};