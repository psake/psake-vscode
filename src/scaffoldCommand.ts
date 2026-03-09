import * as vscode from 'vscode';
import * as path from 'path';
import { DEFAULT_SCRIPT_NAME } from './constants.js';
import { logError } from './log.js';

const TEMPLATE = `Task default -Depends Test

Task Test -Depends Compile, Clean {
\t"This is a test"
}

Task Compile -Depends Clean {
\t"Compile"
}

Task Clean {
\t"Clean"
}
`;

export async function installBuildFileCommand(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        void vscode.window.showErrorMessage('You have not yet opened a folder.');
        return;
    }

    // If multiple workspace folders, ask which one
    let folder: vscode.WorkspaceFolder;
    if (folders.length === 1) {
        folder = folders[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            folders.map(f => ({ label: f.name, description: f.uri.fsPath, folder: f })),
            { placeHolder: 'Select the workspace folder' }
        );
        if (!picked) {
            return;
        }
        folder = picked.folder;
    }

    const config = vscode.workspace.getConfiguration('psake');
    const defaultName: string = config.get('buildFile') ?? DEFAULT_SCRIPT_NAME;

    const name = await vscode.window.showInputBox({
        placeHolder: 'Enter the name for your new build script',
        value: defaultName,
    });

    if (!name) {
        void vscode.window.showWarningMessage('No script name provided.');
        return;
    }

    try {
        const targetUri = vscode.Uri.joinPath(folder.uri, name);

        // Check for existing file
        let exists = false;
        try {
            await vscode.workspace.fs.stat(targetUri);
            exists = true;
        } catch {
            // File does not exist — safe to create
        }

        if (exists) {
            const answer = await vscode.window.showWarningMessage(
                `Overwrite the existing '${name}' file?`,
                'Overwrite'
            );
            if (answer !== 'Overwrite') {
                return;
            }
        }

        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(TEMPLATE, 'utf8'));

        const doc = await vscode.workspace.openTextDocument(targetUri);
        await vscode.window.showTextDocument(doc);

        void vscode.window.showInformationMessage(`psake build file '${path.basename(name)}' created.`);
    } catch (err) {
        logError(err);
    }
}
