import * as vscode from 'vscode';
import { OUTPUT_CHANNEL_NAME } from './constants.js';

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    }
    return channel;
}

export function logError(error: unknown, notify = true): void {
    const message = error instanceof Error ? error.message : String(error);
    const ch = getChannel();
    ch.appendLine(`[Error] ${message}`);
    if (notify) {
        void vscode.window.showErrorMessage(message);
    }
}
