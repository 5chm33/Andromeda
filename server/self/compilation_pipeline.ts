/**
 * Self-Compilation Pipeline
 * 
 * Enables Andromeda to fully rebuild itself from source after any modification.
 * This is the foundational capability for true autonomous self-improvement.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface BuildStage {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
  output?: string;
}

export interface BuildResult {
  success: boolean;
  timestamp: string;
  stages: BuildStage[];
  artifactPath?: string;
  rollbackPath?: string;
  error?: string;
}

const BUILD_ARTIFACT_DIR = 'dist';
const BUILD_BACKUP_DIR = 'dist.backup';

function buildResult(
  success: boolean, 
  stages: BuildStage[], 
  workspaceRoot: string, 
  artifactPath?: string, 
  rollbackPath?: string
): BuildResult {
  return {
    success,
    timestamp: new Date().toISOString(),
    stages,
    artifactPath,
    rollbackPath,
    error: stages.find(s => s.status === 'failed')?.error
  };
}

async function runStage(name: string, fn: () => Promise<string>): Promise<BuildStage> {
  const start = Date.now();
  try {
    const output = await fn();
    return {
      name,
      status: 'passed',
      durationMs: Date.now() - start,
      output
    };
  } catch (error: any) {
    return {
      name,
      status: 'failed',
      durationMs: Date.now() - start,
      error: error.message || String(error)
    };
  }
}

function getBuildScript(workspaceRoot: string): string {
  // In Andromeda v5.40, the build script is one level up
  const pkgPath = join(workspaceRoot, '..', 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.scripts && pkg.scripts.build) {
      return 'npm run build';
    }
  }
  return 'pnpm exec tsc'; // fallback
}

function getEntryPoint(workspaceRoot: string): string | null {
  return 'index.js'; // Andromeda v5 dist/index.js
}

async function rollbackBuild(workspaceRoot: string, rollbackPath?: string): Promise<void> {
  if (!rollbackPath || !existsSync(rollbackPath)) return;
  
  const distPath = join(workspaceRoot, BUILD_ARTIFACT_DIR);
  try {
    if (existsSync(distPath)) {
      execSync(`rm -rf "${distPath}"`, { cwd: workspaceRoot, timeout: 10000 });
    }
    execSync(`cp -r "${rollbackPath}" "${distPath}"`, { cwd: workspaceRoot, timeout: 30000 });
  } catch (e) {
    console.error("Rollback failed:", e);
  }
}

export async function runSelfCompilation(workspaceRoot: string = process.cwd()): Promise<BuildResult> {
  const stages: BuildStage[] = [];
  let _overallSuccess = true;
  let artifactPath: string | undefined;
  let rollbackPath: string | undefined;

  // Since workspaceRoot is often 'server' in v5.40, we adjust to project root for build
  const projectRoot = workspaceRoot.endsWith('server') ? join(workspaceRoot, '..') : workspaceRoot;

  // Stage 1: Pre-build validation
  stages.push(await runStage('Pre-build validation', async () => {
    const errors: string[] = [];

    const pkgPath = join(projectRoot, 'package.json');
    if (!existsSync(pkgPath)) errors.push('package.json not found');

    const tsconfigPath = join(projectRoot, 'tsconfig.json');
    if (!existsSync(tsconfigPath)) errors.push('tsconfig.json not found');

    if (errors.length > 0) throw new Error(errors.join('; '));
    return 'Pre-build validation passed';
  }));

  if (stages[stages.length - 1].status === 'failed') return buildResult(false, stages, projectRoot);

  // Stage 2: Clean TypeScript check
  stages.push(await runStage('TypeScript type check', async () => {
    execSync('pnpm exec tsc --noEmit --pretty false 2>&1', { cwd: projectRoot, timeout: 60000, stdio: 'pipe' });
    return 'TypeScript check passed — no errors';
  }));

  if (stages[stages.length - 1].status === 'failed') return buildResult(false, stages, projectRoot);

  // Stage 3: Backup current build
  stages.push(await runStage('Backup current build', async () => {
    const distPath = join(projectRoot, BUILD_ARTIFACT_DIR);
    const backupPath = join(projectRoot, BUILD_BACKUP_DIR);

    if (existsSync(distPath)) {
      if (existsSync(backupPath)) execSync(`rm -rf "${backupPath}"`, { cwd: projectRoot });
      execSync(`cp -r "${distPath}" "${backupPath}"`, { cwd: projectRoot });
      rollbackPath = backupPath;
      return `Backup created at ${BUILD_BACKUP_DIR}`;
    }
    return 'No existing build to backup';
  }));

  // Stage 4: Clean build
  stages.push(await runStage('Clean build', async () => {
    const distPath = join(projectRoot, BUILD_ARTIFACT_DIR);
    if (existsSync(distPath)) execSync(`rm -rf "${distPath}"`, { cwd: projectRoot });

    const buildScript = getBuildScript(projectRoot);
    execSync(buildScript, { cwd: projectRoot, timeout: 120000, stdio: 'pipe' });

    if (!existsSync(distPath)) throw new Error('Build completed but dist/ directory not created');
    
    artifactPath = distPath;
    return `Build completed`;
  }));

  if (stages[stages.length - 1].status === 'failed') {
    await rollbackBuild(projectRoot, rollbackPath);
    return buildResult(false, stages, projectRoot, artifactPath, rollbackPath);
  }

  // Stage 5: Post-build verification
  stages.push(await runStage('Post-build verification', async () => {
    const entryPoint = getEntryPoint(projectRoot);
    if (entryPoint) {
      const entryPath = join(projectRoot, BUILD_ARTIFACT_DIR, entryPoint);
      if (!existsSync(entryPath)) throw new Error(`Entry point not found: ${entryPath}`);
    }
    return 'Post-build verification passed';
  }));

  if (stages[stages.length - 1].status === 'failed') {
    await rollbackBuild(projectRoot, rollbackPath);
    return buildResult(false, stages, projectRoot, artifactPath, rollbackPath);
  }

  return buildResult(true, stages, projectRoot, artifactPath, rollbackPath);
}

export function formatBuildResults(result: BuildResult): string {
  let out = `Build ${result.success ? 'PASSED' : 'FAILED'} at ${result.timestamp}\n\n`;
  for (const stage of result.stages) {
    const icon = stage.status === 'passed' ? '✅' : stage.status === 'failed' ? '❌' : '⏳';
    out += `${icon} ${stage.name} (${stage.durationMs}ms)\n`;
    if (stage.error) out += `   Error: ${stage.error}\n`;
  }
  return out;
}
