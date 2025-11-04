import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleUpload } from '../src/upload';
import { createMockD1Database, createMockR2Bucket, createMockFormData } from './mocks';

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock_file_id_12')
}));

describe('Upload Handler', () => {
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

  describe('handleUpload', () => {
    it('should successfully upload a file', async () => {
      const formData = createMockFormData([
        { name: 'test.pdf', content: 'file content', type: 'application/pdf' }
      ]);
      
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        body: formData
      });

      const response = await handleUpload(
        request,
        mockDb as any,
        mockBucket as any,
        mockApiKey,
        'https://example.com'
      );

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toEqual({
        url: 'https://example.com/f/mock_file_id_12',
        fileId: 'mock_file_id_12',
        size: 12, // 'file content'.length
        files: [
          {
            url: 'https://example.com/f/mock_file_id_12',
            fileId: 'mock_file_id_12',
            originalName: 'test.pdf',
            size: 12,
            contentType: 'application/pdf'
          }
        ]
      });

      // Verify R2 bucket put was called
      expect(mockBucket.put).toHaveBeenCalledWith(
        'mock_file_id_12',
        expect.any(ArrayBuffer),
        {
          httpMetadata: {
            contentType: 'application/pdf'
          },
          customMetadata: {
            originalName: 'test.pdf',
            uploadedBy: 'Test Key',
            groupId: 'mock_file_id_12',
            relativePath: ''
          }
        }
      );

      // Verify database insert
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO uploads'));
      expect(mockDb._getMockStatement().bind).toHaveBeenCalledWith(
        'mock_file_id_12',
        'mock_file_id_12',
        'test.pdf',
        null,
        12,
        'application/pdf',
        1,
        null
      );
    });

    it('should handle missing file in form data', async () => {
      const formData = new FormData(); // Empty form data
      
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        body: formData
      });

      const response = await handleUpload(
        request,
        mockDb as any,
        mockBucket as any,
        mockApiKey,
        'https://example.com'
      );

      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData).toEqual({ error: 'No file provided' });
    });

    it('should use default content type for files without type', async () => {
      const formData = new FormData();
      const file = new File(['content'], 'test.bin'); // No type specified
      formData.append('file', file);
      
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        body: formData
      });

      await handleUpload(
        request,
        mockDb as any,
        mockBucket as any,
        mockApiKey,
        'https://example.com'
      );

      expect(mockBucket.put).toHaveBeenCalledWith(
        'mock_file_id_12',
        expect.any(ArrayBuffer),
        expect.objectContaining({
          httpMetadata: {
            contentType: 'application/octet-stream'
          }
        })
      );
    });

    it('should handle upload errors gracefully', async () => {
      const formData = createMockFormData([
        { name: 'test.pdf', content: 'file content' }
      ]);
      
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        body: formData
      });

      // Mock R2 bucket to throw error
      mockBucket.put = vi.fn().mockRejectedValue(new Error('Storage error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await handleUpload(
        request,
        mockDb as any,
        mockBucket as any,
        mockApiKey,
        'https://example.com'
      );

      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toEqual({ error: 'Upload failed' });
      expect(consoleSpy).toHaveBeenCalledWith('Upload error:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should handle database errors gracefully', async () => {
      const formData = createMockFormData([
        { name: 'test.pdf', content: 'file content' }
      ]);
      
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        body: formData
      });

      // Mock database to throw error
      mockDb._getMockStatement().run = vi.fn().mockRejectedValue(new Error('DB error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const response = await handleUpload(
        request,
        mockDb as any,
        mockBucket as any,
        mockApiKey,
        'https://example.com'
      );

      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData).toEqual({ error: 'Upload failed' });
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should upload a directory and preserve structure', async () => {
      const formData = createMockFormData(
        [
          { name: 'folder/index.txt', content: 'file-one', type: 'text/plain' },
          { name: 'folder/sub/file-two.txt', content: 'file-two', type: 'text/plain' }
        ],
        { directoryUpload: true }
      );

      const request = new Request('https://example.com/upload', {
        method: 'POST',
        body: formData
      });

      const response = await handleUpload(
        request,
        mockDb as any,
        mockBucket as any,
        mockApiKey,
        'https://example.com'
      );

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.isDirectory).toBe(true);
      expect(responseData.url).toBe('https://example.com/f/mock_file_id_12');
      expect(responseData.fileId).toBe('mock_file_id_12');
      expect(responseData.size).toBe(16);
      expect(responseData.files).toEqual([
        {
          url: 'https://example.com/f/mock_file_id_12/folder/index.txt',
          fileId: 'mock_file_id_12/folder/index.txt',
          originalName: 'index.txt',
          relativePath: 'folder/index.txt',
          size: 8,
          contentType: 'text/plain'
        },
        {
          url: 'https://example.com/f/mock_file_id_12/folder/sub/file-two.txt',
          fileId: 'mock_file_id_12/folder/sub/file-two.txt',
          originalName: 'file-two.txt',
          relativePath: 'folder/sub/file-two.txt',
          size: 8,
          contentType: 'text/plain'
        }
      ]);

      expect(mockBucket.put).toHaveBeenNthCalledWith(
        1,
        'mock_file_id_12/folder/index.txt',
        expect.any(ArrayBuffer),
        expect.objectContaining({
          customMetadata: expect.objectContaining({
            groupId: 'mock_file_id_12',
            relativePath: 'folder/index.txt'
          })
        })
      );

      expect(mockBucket.put).toHaveBeenNthCalledWith(
        2,
        'mock_file_id_12/folder/sub/file-two.txt',
        expect.any(ArrayBuffer),
        expect.objectContaining({
          customMetadata: expect.objectContaining({
            groupId: 'mock_file_id_12',
            relativePath: 'folder/sub/file-two.txt'
          })
        })
      );

      const bindCalls = mockDb._getMockStatement().bind.mock.calls;
      expect(bindCalls).toHaveLength(2);
      expect(bindCalls[0]).toEqual([
        'mock_file_id_12/folder/index.txt',
        'mock_file_id_12',
        'index.txt',
        'folder/index.txt',
        8,
        'text/plain',
        1,
        null
      ]);
      expect(bindCalls[1]).toEqual([
        'mock_file_id_12/folder/sub/file-two.txt',
        'mock_file_id_12',
        'file-two.txt',
        'folder/sub/file-two.txt',
        8,
        'text/plain',
        1,
        null
      ]);
    });

    it('should handle large files correctly', async () => {
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB
      const formData = new FormData();
      const file = new File([largeContent], 'large.dat', { type: 'application/octet-stream' });
      formData.append('file', file);
      
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        body: formData
      });

      const response = await handleUpload(
        request,
        mockDb as any,
        mockBucket as any,
        mockApiKey,
        'https://example.com'
      );

      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.size).toBe(1024 * 1024);
    });
  });
});
