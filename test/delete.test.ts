import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleDelete } from '../src/delete';
import { createMockD1Database, createMockR2Bucket } from './mocks';

describe('Delete Handler', () => {
  let mockDb: ReturnType<typeof createMockD1Database>;
  let mockBucket: ReturnType<typeof createMockR2Bucket>;
  let mockApiKey: any;

  beforeEach(() => {
    mockDb = createMockD1Database();
    mockBucket = createMockR2Bucket();
    mockApiKey = {
      id: 1,
      key: 'pb_test123',
      name: 'Test Key',
      created_at: '2024-01-01',
      last_used: null,
      is_active: 1
    };
    vi.clearAllMocks();
  });

  describe('handleDelete', () => {
    it('should successfully delete a file owned by the API key', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'document.pdf',
        content_type: 'application/pdf',
        size: 1024,
        api_key_id: 1
      };

      mockDb._setMockResult('first', mockUpload);

      const response = await handleDelete(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        mockApiKey
      );

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toEqual({
        message: 'File deleted successfully',
        fileId: 'test_file_123'
      });

      // Verify database query to check ownership
      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM uploads WHERE file_id = ? AND api_key_id = ?'
      );
      expect(mockDb._getMockStatement().bind).toHaveBeenCalledWith('test_file_123', 1);

      // Verify R2 bucket delete was called
      expect(mockBucket.delete).toHaveBeenCalledWith('test_file_123');

      // Verify database delete
      expect(mockDb.prepare).toHaveBeenCalledWith(
        'DELETE FROM uploads WHERE file_id = ? AND api_key_id = ?'
      );
    });

    it('should return 404 when file not found or not owned by API key', async () => {
      mockDb._setMockResult('first', null);

      const response = await handleDelete(
        'nonexistent_file',
        mockDb as any,
        mockBucket as any,
        mockApiKey
      );

      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData).toEqual({ error: 'File not found or access denied' });

      // Should not attempt to delete from storage or database
      expect(mockBucket.delete).not.toHaveBeenCalled();
    });

    it('should prevent deleting files owned by other API keys', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'document.pdf',
        content_type: 'application/pdf',
        size: 1024,
        api_key_id: 2 // Different API key
      };

      // Since we query by api_key_id = 1, this won't be returned
      mockDb._setMockResult('first', null);

      const response = await handleDelete(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        mockApiKey
      );

      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData).toEqual({ error: 'File not found or access denied' });

      expect(mockBucket.delete).not.toHaveBeenCalled();
    });

    it('should handle R2 storage errors gracefully', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'document.pdf',
        content_type: 'application/pdf',
        size: 1024,
        api_key_id: 1
      };

      mockDb._setMockResult('first', mockUpload);
      mockBucket.delete = vi.fn().mockRejectedValue(new Error('R2 error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await handleDelete(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        mockApiKey
      );

      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toEqual({ error: 'Delete failed' });
      expect(consoleSpy).toHaveBeenCalledWith('Delete error:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should handle database errors gracefully', async () => {
      const mockUpload = {
        file_id: 'test_file_123',
        original_name: 'document.pdf',
        content_type: 'application/pdf',
        size: 1024,
        api_key_id: 1
      };

      mockDb._setMockResult('first', mockUpload);
      mockDb._getMockStatement().run = vi.fn().mockRejectedValue(new Error('DB error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await handleDelete(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        mockApiKey
      );

      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toEqual({ error: 'Delete failed' });
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle database query errors gracefully', async () => {
      mockDb.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database connection error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await handleDelete(
        'test_file_123',
        mockDb as any,
        mockBucket as any,
        mockApiKey
      );

      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toEqual({ error: 'Delete failed' });
      expect(consoleSpy).toHaveBeenCalledWith('Delete error:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });
});