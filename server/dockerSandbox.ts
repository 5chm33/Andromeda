/**
 * dockerSandbox.ts — Docker Sandboxing Module (v11.0.0-alpha)
 * Allows Andromeda to execute arbitrary code in an isolated Docker container.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timeout: boolean;
}

export interface SandboxOptions {
  image?: string;
  timeoutMs?: number;
  memoryLimit?: string;
  network?: 'none' | 'bridge';
}

const DEFAULT_IMAGE = 'node:22-alpine';
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MEMORY = '256m';

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info');
    return true;
  } catch {
    return false;
  }
}

export async function executeInSandbox(
  code: string,
  language: 'javascript' | 'typescript' | 'python' | 'bash',
  options: SandboxOptions = {}
): Promise<SandboxResult> {
  const image = options.image ?? DEFAULT_IMAGE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const memoryLimit = options.memoryLimit ?? DEFAULT_MEMORY;
  const network = options.network ?? 'none';

  const runId = crypto.randomBytes(8).toString('hex');
  const workDir = path.join(process.cwd(), '.andromeda', 'sandbox', runId);

  let filename: string;
  let cmd: string;
  let containerImage = image;

  switch (language) {
    case 'javascript':
      filename = 'script.js';
      cmd = 'node script.js';
      containerImage = 'node:22-alpine';
      break;
    case 'typescript':
      filename = 'script.ts';
      cmd = 'npx ts-node script.ts';
      containerImage = 'node:22-alpine';
      break;
    case 'python':
      filename = 'script.py';
      cmd = 'python3 script.py';
      containerImage = 'python:3.11-alpine';
      break;
    case 'bash':
    default:
      filename = 'script.sh';
      cmd = 'sh script.sh';
      containerImage = 'alpine:latest';
      break;
  }

  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, filename), code);

  const containerName = `andromeda_sandbox_${runId}`;
  const startTime = Date.now();
  let timedOut = false;

  const dockerCmd = [
    'docker run',
    '--rm',
    `--name ${containerName}`,
    `--memory=${memoryLimit}`,
    `--network=${network}`,
    '--cpus=1.0',
    `--volume ${workDir}:/sandbox:ro`,
    '--workdir /sandbox',
    containerImage,
    `/bin/sh -c "${cmd}"`,
  ].join(' ');

  try {
    const result = await Promise.race([
      execAsync(dockerCmd),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error('SANDBOX_TIMEOUT'));
        }, timeoutMs)
      ),
    ]);

    if (!result) {
      throw new Error('SANDBOX_TIMEOUT');
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
      durationMs: Date.now() - startTime,
      timeout: false,
    };
  } catch (error: any) {
    if (timedOut || error.message === 'SANDBOX_TIMEOUT') {
      try { await execAsync(`docker kill ${containerName}`); } catch { /* ignore */ }
      return {
        stdout: '',
        stderr: `Execution timed out after ${timeoutMs}ms`,
        exitCode: 124,
        durationMs: Date.now() - startTime,
        timeout: true,
      };
    }
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message,
      exitCode: error.code ?? 1,
      durationMs: Date.now() - startTime,
      timeout: false,
    };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
