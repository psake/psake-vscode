import * as childProcess from 'child_process';
import * as vscode from 'vscode';

/**
 * Detects and returns the best available PowerShell executable.
 *
 * Resolution order:
 * 1. `psake.powershellExecutable` configuration value (if set)
 * 2. `pwsh` (PowerShell 7+), if found on PATH
 * 3. `powershell` (Windows PowerShell 5.1), if found on PATH
 * 4. Falls back to `pwsh` and lets any error surface at runtime.
 */
export async function detectPowerShellExecutable(): Promise<string> {
  const config = vscode.workspace.getConfiguration('psake');
  const configured: string = config.get('powershellExecutable') ?? '';
  if (configured) {
    return configured;
  }

  for (const exe of ['pwsh', 'powershell']) {
    if (await testExecutable(exe)) {
      return exe;
    }
  }

  return 'pwsh';
}

export function testExecutable(executable: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const ps = childProcess.spawn(
      executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Write-Host "OK"'],
      { shell: true }
    );

    let hasOutput = false;
    ps.stdout.on('data', () => { hasOutput = true; });
    ps.on('close', (code: number) => resolve(code === 0 && hasOutput));
    ps.on('error', () => resolve(false));
  });
}

/**
 * Spawns a PowerShell process and returns its stdout as a trimmed string.
 * Rejects if the process exits with a non-zero code.
 */
export function runPowerShellScript(executable: string, script: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const ps = childProcess.spawn(
      executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { shell: true }
    );

    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    ps.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    ps.on('close', (code: number) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`PowerShell exited ${code}: ${stderr.trim()}`));
      }
    });
    ps.on('error', reject);
  });
}
