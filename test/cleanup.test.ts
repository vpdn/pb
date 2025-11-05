import { describe, it, expect, vi } from 'vitest';
import { cleanupExpiredFiles } from '../src/cleanup';

describe('cleanupExpiredFiles', () => {
  it('queries expired files using datetime conversion', async () => {
    const mockStmt = {
      bind: vi.fn().mockReturnValue({
        all: vi.fn(async () => ({ success: true, results: [] }))
      })
    };

    const db = {
      prepare: vi.fn(() => mockStmt)
    };

    const bucket = {
      delete: vi.fn()
    };

    await cleanupExpiredFiles(db as any, bucket as any);

    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('datetime(expires_at)'));
  });

  it('deletes expired ISO-timestamped uploads and removes them from storage', async () => {
    const expiredFiles = [
      { file_id: 'file-1', original_name: 'one.txt' },
      { file_id: 'dir/group/file-2', original_name: 'two.txt' }
    ];

    const selectAll = vi.fn(async () => ({
      success: true,
      results: expiredFiles
    }));

    const deleteRun = vi.fn(async () => ({ success: true }));

    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT')) {
          return {
            bind: vi.fn(() => ({
              all: selectAll
            }))
          };
        }

        if (sql.includes('DELETE FROM uploads')) {
          return {
            bind: vi.fn(() => ({
              run: deleteRun
            }))
          };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      })
    };

    const bucket = {
      delete: vi.fn(async () => Promise.resolve())
    };

    const result = await cleanupExpiredFiles(db as any, bucket as any);

    expect(result.deletedCount).toBe(expiredFiles.length);
    expect(bucket.delete).toHaveBeenCalledTimes(expiredFiles.length);
    expiredFiles.forEach((file, index) => {
      expect(bucket.delete).toHaveBeenNthCalledWith(index + 1, file.file_id);
    });
    expect(deleteRun).toHaveBeenCalledTimes(expiredFiles.length);
  });
});
