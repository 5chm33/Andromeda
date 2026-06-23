import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeInSandbox, isDockerAvailable } from './dockerSandbox.js';

vi.mock('child_process', () => ({
  exec: vi.fn((cmd: string, cb: any) => {
    if (cmd === 'docker info') {
      cb(null, { stdout: 'Server: Docker Engine', stderr: '' });
    } else if (cmd.includes('docker run') && cmd.includes('python')) {
      cb(null, { stdout: 'Hello from Python\n', stderr: '' });
    } else if (cmd.includes('docker run') && cmd.includes('node')) {
      cb(null, { stdout: 'Hello from Node\n', stderr: '' });
    } else if (cmd.includes('docker kill')) {
      cb(null, { stdout: '', stderr: '' });
    } else {
      cb(Object.assign(new Error('Command failed'), { code: 1, stdout: '', stderr: 'error' }), { stdout: '', stderr: '' });
    }
  }),
}));

describe('isDockerAvailable', () => {
  it('returns true when docker info succeeds', async () => {
    const result = await isDockerAvailable();
    expect(result).toBe(true);
  });
});

describe('executeInSandbox', () => {
  beforeEach(() => vi.clearAllMocks());

  it('executes python code and returns stdout', async () => {
    const result = await executeInSandbox('print("Hello from Python")', 'python');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello from Python');
    expect(result.timeout).toBe(false);
  });

  it('executes javascript code and returns stdout', async () => {
    const result = await executeInSandbox('console.log("Hello from Node")', 'javascript');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Hello from Node');
  });

  it('returns non-zero exit code on failure', async () => {
    const { exec } = await import('child_process');
    (exec as any).mockImplementationOnce((cmd: string, cb: any) => {
      cb(Object.assign(new Error('SyntaxError'), { code: 1, stdout: '', stderr: 'SyntaxError: invalid syntax' }), { stdout: '', stderr: '' });
    });
    const result = await executeInSandbox('print("bad"', 'python');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SyntaxError');
  });

  it('returns SandboxResult with all required fields', async () => {
    const result = await executeInSandbox('console.log("test")', 'javascript');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('timeout');
  });
});
