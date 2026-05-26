import { describe, it, expect, vi } from 'vitest';

vi.mock('./twoPhaseCommit.js', () => ({
  twoPhaseCommit: vi.fn().mockResolvedValue({ success: true }),
  getActiveCommits: vi.fn().mockReturnValue({}),
}));

describe('selfHeal', () => {
  it('module loads without errors', async () => {
    const Module = await import('./selfModify.js');
    expect(Module).toBeDefined();
  });

  it('restoreFromBackup is a function', async () => {
    const { restoreFromBackup } = await import('./selfModify.js');
    expect(typeof restoreFromBackup).toBe('function');
  });

  it('should detect missing export in module', async () => {
    const { restoreFromBackup } = await import('./selfModify.js');
    // restoreFromBackup returns { success: false } for non-existent backup
    const result = restoreFromBackup('nonexistent-backup-id');
    expect(result).toHaveProperty('success');
    expect(result.success).toBe(false);
  });
});
