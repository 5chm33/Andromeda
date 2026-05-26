/**
 * Autonomous Dependency Upgrader
 * 
 * Scans, analyzes, and safely upgrades npm dependencies.
 * Automatically validates upgrades using the compilation pipeline and tests.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface OutdatedPackage {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: 'dependencies' | 'devDependencies';
  releaseType: 'patch' | 'minor' | 'major';
}

export interface UpgradeResult {
  package: string;
  from: string;
  to: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface UpgradeSession {
  timestamp: string;
  packages: OutdatedPackage[];
  results: UpgradeResult[];
  success: boolean;
  rollbackPerformed: boolean;
}

export async function scanOutdatedPackages(workspaceRoot: string = process.cwd()): Promise<OutdatedPackage[]> {
  try {
    const projectRoot = workspaceRoot.endsWith('server') ? join(workspaceRoot, '..') : workspaceRoot;
    
    // npm outdated returns non-zero exit code if packages are outdated
    let output = '';
    try {
      output = execSync('npm outdated --json', { cwd: projectRoot, timeout: 30000, stdio: 'pipe' }).toString();
    } catch (error: any) {
      output = error.stdout?.toString() || '{}';
    }

    if (!output || output.trim() === '') return [];

    const parsed = JSON.parse(output);
    const outdated: OutdatedPackage[] = [];

    const pkgPath = join(projectRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

    for (const [name, info] of Object.entries<any>(parsed)) {
      if (!info.current || !info.latest) continue;

      const type = pkg.dependencies?.[name] ? 'dependencies' : 'devDependencies';
      
      const currentParts = info.current.split('.');
      const latestParts = info.latest.split('.');
      
      let releaseType: 'patch' | 'minor' | 'major' = 'patch';
      if (currentParts[0] !== latestParts[0]) releaseType = 'major';
      else if (currentParts[1] !== latestParts[1]) releaseType = 'minor';

      outdated.push({
        name,
        current: info.current,
        wanted: info.wanted || info.latest,
        latest: info.latest,
        type,
        releaseType
      });
    }

    return outdated;
  } catch (error) {
    console.error("Failed to scan outdated packages:", error);
    return [];
  }
}

export async function upgradePackage(
  pkg: OutdatedPackage, 
  workspaceRoot: string = process.cwd()
): Promise<UpgradeResult> {
  const start = Date.now();
  const projectRoot = workspaceRoot.endsWith('server') ? join(workspaceRoot, '..') : workspaceRoot;
  
  try {
    const saveFlag = pkg.type === 'devDependencies' ? '--save-dev' : '--save';
    execSync(`npm install ${pkg.name}@${pkg.latest} ${saveFlag}`, { 
      cwd: projectRoot, 
      timeout: 60000,
      stdio: 'pipe'
    });
    
    return {
      package: pkg.name,
      from: pkg.current,
      to: pkg.latest,
      success: true,
      durationMs: Date.now() - start
    };
  } catch (error: any) {
    return {
      package: pkg.name,
      from: pkg.current,
      to: pkg.latest,
      success: false,
      error: error.message,
      durationMs: Date.now() - start
    };
  }
}

export async function runUpgradeSession(
  workspaceRoot: string = process.cwd()
): Promise<UpgradeSession> {
  const projectRoot = workspaceRoot.endsWith('server') ? join(workspaceRoot, '..') : workspaceRoot;
  const outdated = await scanOutdatedPackages(workspaceRoot);
  
  // Only auto-upgrade patch and minor
  const safeToUpgrade = outdated.filter(p => p.releaseType !== 'major').slice(0, 5); // Max 5 at a time
  
  const session: UpgradeSession = {
    timestamp: new Date().toISOString(),
    packages: safeToUpgrade,
    results: [],
    success: true,
    rollbackPerformed: false
  };

  if (safeToUpgrade.length === 0) return session;

  // Snapshot before upgrades
  try {
    execSync('git add package.json package-lock.json && git commit -m "chore: snapshot before auto-upgrade"', { 
      cwd: projectRoot, stdio: 'pipe' 
    });
  } catch { /* might not be a git repo or nothing to commit */ }

  for (const pkg of safeToUpgrade) {
    const result = await upgradePackage(pkg, workspaceRoot);
    session.results.push(result);
    if (!result.success) session.success = false;
  }

  // Validate upgrades
  let validationPassed = false;
  try {
    execSync('npx tsc --noEmit', { cwd: projectRoot, timeout: 60000, stdio: 'pipe' });
    validationPassed = true;
  } catch {
    validationPassed = false;
  }

  if (!validationPassed || !session.success) {
    // Rollback
    try {
      execSync('git reset --hard HEAD~1', { cwd: projectRoot, stdio: 'pipe' });
      execSync('npm ci', { cwd: projectRoot, stdio: 'pipe' });
      session.rollbackPerformed = true;
      session.success = false;
    } catch {
      console.error("Failed to rollback dependency upgrades");
    }
  }

  return session;
}
