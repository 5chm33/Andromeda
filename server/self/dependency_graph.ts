/**
 * Dependency Graph Analyzer
 * 
 * Maps all imports/exports across the codebase to enable
 * architecture-level refactoring proposals.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';

export interface DependencyNode {
  path: string;
  exports: string[];
  imports: ImportEdge[];
  isEntryPoint: boolean;
  fileSize: number;
  lastModified: Date;
}

export interface ImportEdge {
  source: string;
  target: string;
  importedSymbols: string[];
  isDefault: boolean;
  isTypeOnly: boolean;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  entryPoints: string[];
  circularDependencies: string[][];
  orphanedModules: string[];
  heavilyImportedModules: Map<string, number>;
}

export async function buildDependencyGraph(
  workspaceRoot: string = process.cwd()
): Promise<DependencyGraph> {
  // In v5.40, workspaceRoot might be project root or server dir
  const srcDir = workspaceRoot.endsWith('server') ? workspaceRoot : join(workspaceRoot, 'server');
  const nodes = new Map<string, DependencyNode>();
  const entryPoints: string[] = [];
  
  const files = collectTypeScriptFiles(srcDir);
  
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const relativePath = relative(srcDir, file).replace(/\\/g, '/');
    const stat = statSync(file);
    
    const exports = extractExports(content);
    const imports = extractImports(content, file, srcDir);
    
    const isEntryPoint = 
      file.endsWith('index.ts') || 
      file.endsWith('server.ts') ||
      file.endsWith('main.ts');
    
    if (isEntryPoint) entryPoints.push(relativePath);
    
    nodes.set(relativePath, {
      path: relativePath,
      exports,
      imports,
      isEntryPoint,
      fileSize: stat.size,
      lastModified: stat.mtime,
    });
  }
  
  const circularDependencies = detectCircularDependencies(nodes);
  const orphanedModules = findOrphanedModules(nodes, entryPoints);
  const heavilyImportedModules = findHeavilyImportedModules(nodes);
  
  return {
    nodes,
    entryPoints,
    circularDependencies,
    orphanedModules,
    heavilyImportedModules,
  };
}

function collectTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        files.push(...collectTypeScriptFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))) {
        files.push(fullPath);
      }
    }
  } catch { }
  return files;
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const namedExportRegex = /export\s+(?:const|function|class|interface|type|enum|default\s+(?:class|function))\s+(\w+)/g;
  let match;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  if (/export\s+default/.test(content)) exports.push('default');
  const reExportRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    exports.push(`* from ${match[1]}`);
  }
  return exports;
}

function extractImports(content: string, filePath: string, workspaceRoot: string): ImportEdge[] {
  const imports: ImportEdge[] = [];
  const fileDir = dirname(filePath);
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:,\s*\{[^}]*\})?)\s+from\s+)?['"]([^'"]+)['"]/g;
  
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) continue;
    
    let targetPath: string;
    if (importPath.startsWith('/')) targetPath = join(workspaceRoot, importPath);
    else targetPath = resolve(fileDir, importPath);
    
    const resolved = resolveImportPath(targetPath, workspaceRoot);
    if (!resolved) continue;
    
    const relativeTarget = relative(workspaceRoot, resolved).replace(/\\/g, '/');
    
    const importedSymbols: string[] = [];
    const symbolMatch = match[0].match(/\{([^}]+)\}/);
    if (symbolMatch) {
      symbolMatch[1].split(',').forEach(s => {
        const trimmed = s.trim();
        if (trimmed) importedSymbols.push(trimmed);
      });
    }
    
    imports.push({
      source: relative(fileDir, filePath).replace(/\\/g, '/'),
      target: relativeTarget,
      importedSymbols,
      isDefault: /import\s+\w+\s+from/.test(match[0]),
      isTypeOnly: /import\s+type\s+/.test(match[0]),
    });
  }
  return imports;
}

function resolveImportPath(targetPath: string, workspaceRoot: string): string | null {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
  for (const ext of extensions) {
    const fullPath = targetPath + ext;
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

function detectCircularDependencies(nodes: Map<string, DependencyNode>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const pathStack: string[] = [];
  
  function dfs(nodePath: string) {
    if (recursionStack.has(nodePath)) {
      const cycleStart = pathStack.indexOf(nodePath);
      if (cycleStart !== -1) cycles.push([...pathStack.slice(cycleStart), nodePath]);
      return;
    }
    if (visited.has(nodePath)) return;
    
    visited.add(nodePath);
    recursionStack.add(nodePath);
    pathStack.push(nodePath);
    
    const node = nodes.get(nodePath);
    if (node) {
      for (const imp of node.imports) {
        if (nodes.has(imp.target)) dfs(imp.target);
      }
    }
    
    pathStack.pop();
    recursionStack.delete(nodePath);
  }
  
  for (const [nodePath] of nodes) {
    if (!visited.has(nodePath)) dfs(nodePath);
  }
  return cycles;
}

function findOrphanedModules(nodes: Map<string, DependencyNode>, entryPoints: string[]): string[] {
  const imported = new Set<string>();
  for (const [, node] of nodes) {
    for (const imp of node.imports) imported.add(imp.target);
  }
  const orphaned: string[] = [];
  for (const [nodePath] of nodes) {
    if (!imported.has(nodePath) && !entryPoints.includes(nodePath)) orphaned.push(nodePath);
  }
  return orphaned;
}

function findHeavilyImportedModules(nodes: Map<string, DependencyNode>): Map<string, number> {
  const importCount = new Map<string, number>();
  for (const [, node] of nodes) {
    for (const imp of node.imports) {
      importCount.set(imp.target, (importCount.get(imp.target) || 0) + 1);
    }
  }
  return new Map([...importCount.entries()].sort((a, b) => b[1] - a[1]));
}
