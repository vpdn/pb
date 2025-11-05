import { describe, it, expect, vi } from 'vitest';
import { handleList } from '../src/list';

const apiKey = {
  id: 1,
  key: 'pb_test123',
  name: 'Test Key',
  created_at: '2024-01-01',
  last_used: null,
  is_active: 1
};

function createDbMock(results: any[]) {
  const all = vi.fn(async () => ({
    success: true,
    results
  }));

  const bind = vi.fn(() => ({
    all
  }));

  return {
    prepare: vi.fn(() => ({
      bind
    })),
    _all: all,
    _bind: bind
  };
}

describe('handleList', () => {
  it('builds file URLs using the provided base URL', async () => {
    const db = createDbMock([
      {
        file_id: 'file123',
        group_id: 'file123',
        original_name: 'example.txt',
        relative_path: null,
        size: 42,
        content_type: 'text/plain',
        uploaded_at: '2024-01-01T00:00:00Z',
        last_accessed_at: null,
        access_count: 0,
        expires_at: null
      }
    ]);

    const response = await handleList(db as any, apiKey as any, 'https://alt.example');
    const body = await response.json();

    expect(body.files[0].url).toBe('https://alt.example/f/file123');
    expect(body.files[0].isDirectoryItem).toBe(false);
    expect(db.prepare).toHaveBeenCalled();
  });

  it('normalizes trailing slashes and encodes file IDs with subpaths', async () => {
    const db = createDbMock([
      {
        file_id: 'group123/folder/my file.txt',
        group_id: 'group123',
        original_name: 'my file.txt',
        relative_path: 'folder/my file.txt',
        size: 512,
        content_type: 'text/plain',
        uploaded_at: '2024-01-01T00:00:00Z',
        last_accessed_at: null,
        access_count: 3,
        expires_at: null
      }
    ]);

    const response = await handleList(db as any, apiKey as any, 'https://example.com/');
    const body = await response.json();
    const file = body.files[0];

    expect(file.url).toBe('https://example.com/f/group123/folder/my%20file.txt');
    expect(file.relativePath).toBe('folder/my file.txt');
    expect(file.isDirectoryItem).toBe(true);
  });
});
