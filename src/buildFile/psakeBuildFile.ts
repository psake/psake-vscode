import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DEFAULT_SCRIPT_NAME } from "../constants";

export class psakeBuildFile {

    constructor(public scriptName: string = DEFAULT_SCRIPT_NAME) { }

    public getTargetPath(): string {
        if (vscode.workspace.rootPath) {
            return path.join(vscode.workspace.rootPath, this.scriptName);
        }

        return "";
    }

    public create(): Thenable<boolean> {
        return new Promise((resolve, reject) => {
            try {
                let buildFile = fs.createWriteStream(this.getTargetPath(), {
                    flags: 'a'
                });

                buildFile.write('Task default -Depends Test\n');
                buildFile.write('\n');
                buildFile.write('Task Test -Depends Compile, Clean {\n');
                buildFile.write('\t"This is a test"\n');
                buildFile.write('}\n');
                buildFile.write('\n');
                buildFile.write('Task Compile -Depends Clean {\n');
                buildFile.write('\t"Compile"\n');
                buildFile.write('}\n');
                buildFile.write('\n');
                buildFile.write('Task Clean {\n');
                buildFile.write('\t"Clean"\n');
                buildFile.write('}\n');
                buildFile.end();

                buildFile.on('finish', function() {
                    vscode.workspace.openTextDocument(buildFile.path.toString()).then((document) => {
                        vscode.window.showTextDocument(document);
                    });
                    resolve(true);
                });
            } catch (error) {
                reject(false);
            }
        });
    }
}
