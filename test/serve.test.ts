import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleServe } from '../src/serve';
import { createMockD1Database, createMockR2Bucket } from './mocks';

describe('Serve Handler', () => {
  let mockDb: ReturnType<typeof createMockD1Database>;
  let mockBucket: ReturnType<typeof createMockR2Bucket>;

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
        mockBucket as any
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/pdf');
      expect(response.headers.get('Content-Length')).toBe('1024');
      expect(response.headers.get('Content-Disposition')).toBe('inline; filename="document.pdf"');
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
        mockBucket as any
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
        mockBucket as any
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
        mockBucket as any
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
        mockBucket as any
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Disposition')).toBe(
        'inline; filename="file with spaces & special.pdf"'
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDb.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await handleServe(
        'test_file_123',
        mockDb as any,
        mockBucket as any
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
        mockBucket as any
      );

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toBe('Error serving file');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});