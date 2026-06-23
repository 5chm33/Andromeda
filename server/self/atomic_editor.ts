/**
 * Atomic Multi-File Editor
 * 
 * Allows applying edits across multiple files in a single atomic transaction.
 * If any edit fails, all changes are rolled back automatically.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

export interface FileEdit {
  filePath: string;
  operation: 'write' | 'modify' | 'delete' | 'rename';
  content?: string;
  oldContent?: string;
  insertAfter?: string;
  insertBefore?: string;
  replaceLine?: number;
  newPath?: string; // For rename
}

export interface FileEditResult {
  filePath: string;
  operation: string;
  success: boolean;
  error?: string;
}

export interface TransactionSession {
  id: string;
  status: 'pending' | 'committed' | 'rolled_back' | 'failed';
  edits: FileEdit[];
  results: FileEditResult[];
  backups: Backup[];
  error?: string;
}

interface Backup {
  filePath: string;
  backupPath: string;
  existed: boolean;
}

export async function applyAtomicEdits(
  edits: FileEdit[],
  workspaceRoot: string = process.cwd()
): Promise<TransactionSession> {
  const session: TransactionSession = {
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    status: 'pending',
    edits,
    results: [],
    backups: [],
  };

  try {
    // 1. Create backups
    session.backups = createBackups(edits, workspaceRoot);

    // 2. Apply edits
    for (const edit of edits) {
      const result = applyFileEdit(edit, workspaceRoot);
      session.results.push(result);

      if (!result.success) {
        throw new Error(`Edit failed for ${edit.filePath}: ${result.error}`);
      }
    }

    // 3. Commit
    session.status = 'committed';
    cleanupBackups(session.backups);
    
  } catch (error: any) {
    // 4. Rollback on failure
    session.status = 'rolled_back';
    session.error = error.message;
    rollbackChanges(session.backups, workspaceRoot);
  }

  return session;
}

function createBackups(edits: FileEdit[], workspaceRoot: string): Backup[] {
  const backups: Backup[] = [];
  const backupDir = join(workspaceRoot, '.atomic_editor_backups');

  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  for (const edit of edits) {
    const absolutePath = join(workspaceRoot, edit.filePath);
    const backupPath = join(backupDir, `${Date.now()}_${edit.filePath.replace(/[\\/\\\\]/g, '_')}`);

    if (existsSync(absolutePath)) {
      const content = readFileSync(absolutePath, 'utf-8');
      mkdirSync(dirname(backupPath), { recursive: true });
      writeFileSync(backupPath, content, 'utf-8');
      backups.push({ filePath: edit.filePath, backupPath, existed: true });
    } else {
      backups.push({ filePath: edit.filePath, backupPath: '', existed: false });
    }
  }

  return backups;
}

function rollbackChanges(backups: Backup[], workspaceRoot: string): void {
  for (const backup of backups) {
    const absolutePath = join(workspaceRoot, backup.filePath);

    if (backup.existed && backup.backupPath && existsSync(backup.backupPath)) {
      const content = readFileSync(backup.backupPath, 'utf-8');
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, 'utf-8');
    } else if (!backup.existed) {
      if (existsSync(absolutePath)) {
        unlinkSync(absolutePath);
      }
    }
  }

  const backupDir = join(workspaceRoot, '.atomic_editor_backups');
  if (existsSync(backupDir)) {
    try { execSync(`rm -rf "${backupDir}"`, { timeout: 5000 }); } catch { }
  }
}

function cleanupBackups(backups: Backup[]): void {
  const backupDir = backups.length > 0 ? dirname(backups[0].backupPath) : '';
  if (backupDir && existsSync(backupDir)) {
    try { execSync(`rm -rf "${backupDir}"`, { timeout: 5000 }); } catch { }
  }
}

function applyFileEdit(edit: FileEdit, workspaceRoot: string): FileEditResult {
  const absolutePath = join(workspaceRoot, edit.filePath);
  const result: FileEditResult = { filePath: edit.filePath, operation: edit.operation, success: false };

  try {
    if (edit.operation === 'write') {
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, edit.content || '', 'utf-8');
      result.success = true;
    } else if (edit.operation === 'modify') {
      if (!existsSync(absolutePath)) throw new Error('File does not exist');
      let content = readFileSync(absolutePath, 'utf-8');
      if (edit.oldContent) {
        content = content.replace(edit.oldContent, edit.content || '');
      } else {
        content = edit.content || '';
      }
      writeFileSync(absolutePath, content, 'utf-8');
      result.success = true;
    } else if (edit.operation === 'delete') {
      if (existsSync(absolutePath)) unlinkSync(absolutePath);
      result.success = true;
    } else if (edit.operation === 'rename' && edit.newPath) {
      if (!existsSync(absolutePath)) throw new Error('File does not exist');
      const newAbsolutePath = join(workspaceRoot, edit.newPath);
      mkdirSync(dirname(newAbsolutePath), { recursive: true });
      const content = readFileSync(absolutePath, 'utf-8');
      writeFileSync(newAbsolutePath, content, 'utf-8');
      unlinkSync(absolutePath);
      result.success = true;
    }
  } catch (error: any) {
    result.error = error.message;
  }

  return result;
}
