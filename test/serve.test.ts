import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleServe } from '../src/serve';
import { createMockD1Database, createMockR2Bucket } from './mocks';

describe('Serve Handler', () => {
  let mockDb: ReturnType<typeof createMockD1Database>;
  let mockBucket: ReturnType<typeof createMockR2Bucket>;
  const baseUrl = 'https://example.com';

  beforeEach(() => {
    mockDb = createMockD1Database();
    mockBucket = createMockR2Bucket();
    vi.clearAllMocks();
  });

  describe('handleServe', () => {
    it('should successfully serve a file', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'document.pdf',
        content_type: 'application/pdf',
        size: 1024
      };

      mockDb._setMockResult('first', mockUpload);

      // Put a file in mock storage
      const fileContent = new ArrayBuffer(1024);
      await mockBucket.put('test_file_123', fileContent);

      const response = await handleServe(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/pdf');
      expect(response.headers.get('Content-Length')).toBe('1024');
      expect(response.headers.get('Content-Disposition')).toBe(
        "inline; filename=\"document.pdf\"; filename*=UTF-8''document.pdf"
      );
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000');

      // Verify database query
      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM uploads WHERE file_id = ?'
      );
      expect(mockDb._getMockStatement().bind).toHaveBeenCalledWith('test_file_123');
    });

    it('should return 404 when file not found in database', async () => {
      mockDb._setMockResult('first', null);

      const response = await handleServe(
        'nonexistent_file',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe('File not found');
    });

    it('should return 404 when file not found in storage', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'document.pdf',
        content_type: 'application/pdf',
        size: 1024
      };

      mockDb._setMockResult('first', mockUpload);
      // Don't put file in storage - it will return null

      const response = await handleServe(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe('File not found in storage');
    });

    it('should use default content type when not specified', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'unknown.bin',
        content_type: null, // No content type
        size: 512
      };

      mockDb._setMockResult('first', mockUpload);

      const fileContent = new ArrayBuffer(512);
      await mockBucket.put('test_file_123', fileContent);

      const response = await handleServe(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('should handle special characters in filename', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'file with spaces & special.pdf',
        content_type: 'application/pdf',
        size: 2048
      };

      mockDb._setMockResult('first', mockUpload);

      const fileContent = new ArrayBuffer(2048);
      await mockBucket.put('test_file_123', fileContent);

      const response = await handleServe(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Disposition')).toBe(
        "inline; filename=\"file with spaces & special.pdf\"; filename*=UTF-8''file%20with%20spaces%20%26%20special.pdf"
      );
    });

    it('should encode filenames with quotes and newlines to prevent header injection', async () => {
      const mockUpload = {
        file_id: 'evil_file_456',
        original_name: 'bad"\r\nSet-Cookie: attack.txt',
        content_type: 'text/plain',
        size: 128
      };

      mockDb._setMockResult('first', mockUpload);

      const fileContent = new ArrayBuffer(128);
      await mockBucket.put('evil_file_456', fileContent);

      const response = await handleServe(
        'evil_file_456',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(200);
      const header = response.headers.get('Content-Disposition');
      expect(header).toBe(
        "inline; filename=\"bad' Set-Cookie: attack.txt\"; filename*=UTF-8''bad%22%0D%0ASet-Cookie%3A%20attack.txt"
      );
      expect(header).not.toMatch(/[\r\n]/);
    });

    it('should handle database errors gracefully', async () => {
      mockDb.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await handleServe(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toBe('Error serving file');
      expect(consoleSpy).toHaveBeenCalledWith('Serve error:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should handle R2 errors gracefully', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'document.pdf',
        content_type: 'application/pdf',
        size: 1024
      };

      mockDb._setMockResult('first', mockUpload);

      // Mock R2 to throw error
      mockBucket.get = vi.fn().mockRejectedValue(new Error('R2 error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await handleServe(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toBe('Error serving file');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should render directory listings when a folder ID is requested', async () => {
      mockDb._setMockResult('first', null);
      mockDb._setMockResult('all', {
        success: true,
        results: [
          {
            file_id: 'group123/folder/index.txt',
            original_name: 'index.txt',
            relative_path: 'folder/index.txt',
            size: 12,
            expires_at: null
          },
          {
            file_id: 'group123/folder/notes.md',
            original_name: 'notes.md',
            relative_path: 'folder/notes.md',
            size: 24,
            expires_at: null
          }
        ]
      });

      const response = await handleServe(
        'group123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
      expect(mockBucket.get).not.toHaveBeenCalled();

      const html = await response.text();
      expect(html).toContain('Directory listing for <code>group123</code>');
      expect(html).toContain('href="https://example.com/f/group123/folder/index.txt"');
      expect(html).toContain('folder/notes.md');
    });

    it('should return 410 for expired directory listings', async () => {
      const expiresAt = new Date(Date.now() - 60_000).toISOString();
      mockDb._setMockResult('first', null);
      mockDb._setMockResult('all', {
        success: true,
        results: [
          {
            file_id: 'group123/file.txt',
            original_name: 'file.txt',
            relative_path: 'file.txt',
            size: 10,
            expires_at: expiresAt
          }
        ]
      });

      const response = await handleServe(
        'group123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(410);
      expect(await response.text()).toBe('File has expired');
    });
  });
});
