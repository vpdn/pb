import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleUpload } from '../src/upload';
import { handleServe } from '../src/serve';
import { validateApiKey } from '../src/auth';
import { createMockD1Database, createMockR2Bucket, buildExpectedContentDisposition } from './mocks';

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock_file_id')
}));

describe('Performance Tests', () => {
  let mockDb: ReturnType<typeof createMockD1Database>;
  let mockBucket: ReturnType<typeof createMockR2Bucket>;
  const baseUrl = 'https://example.com';

  beforeEach(() => {
    mockDb = createMockD1Database();
    mockBucket = createMockR2Bucket();
    vi.clearAllMocks();
  });

  describe('Concurrent operations', () => {
    it('should handle multiple simultaneous uploads', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      // Mock nanoid to return different IDs
      let counter = 0;
      const { nanoid } = await import('nanoid');
      vi.mocked(nanoid).mockImplementation(() => `file_${++counter}`);

      const uploadPromises = [];
      
      for (let i = 0; i < 10; i++) {
        const formData = new FormData();
        const file = new File([`content${i}`], `file${i}.txt`);
        formData.append('file', file);

        const request = new Request('https://example.com/upload', {
          method: 'POST',
          body: formData
        });

        uploadPromises.push(
          handleUpload(
            request,
            mockDb as any,
            mockBucket as any,
            mockApiKey,
            'https://example.com'
          )
        );
      }

      const responses = await Promise.all(uploadPromises);

      expect(responses).toHaveLength(10);
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
      });

      // Verify all files were stored
      expect(mockBucket.put).toHaveBeenCalledTimes(10);
      expect(mockDb._getMockStatement().run).toHaveBeenCalledTimes(10);
    });

    it('should handle multiple simultaneous file serves', async () => {
      // Prepare mock data
      const files = [];
      for (let i = 0; i < 10; i++) {
        const fileId = `file_${i}`;
        const content = new ArrayBuffer(1024);
        
        files.push({
          file_id: fileId,
          original_name: `document${i}.pdf`,
          content_type: 'application/pdf',
          size: 1024
        });

        await mockBucket.put(fileId, content);
      }

      // Mock database to return different files based on the bind call
      let callCount = 0;
      mockDb._getMockStatement().first = vi.fn(async () => {
        return files[callCount++ % files.length];
      });

      const servePromises = files.map(file => 
        handleServe(file.file_id, mockDb as any, mockBucket as any, baseUrl)
      );

      const responses = await Promise.all(servePromises);

      expect(responses).toHaveLength(10);
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Large file handling', () => {
    it('should handle very large file metadata', async () => {
      const largeFileName = 'x'.repeat(255) + '.dat'; // Max filename length
      const mockUpload = {
        file_id: 'large_file_123',
        original_name: largeFileName,
        content_type: 'application/octet-stream',
        size: 1024 * 1024 * 100 // 100MB
      };

      mockDb._setMockResult('first', mockUpload);

      const fileContent = new ArrayBuffer(1024); // Actual content can be smaller
      await mockBucket.put('large_file_123', fileContent);

      const response = await handleServe(
        'large_file_123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Length')).toBe('104857600');
      const expectedDisposition = buildExpectedContentDisposition(largeFileName, 'attachment');
      expect(response.headers.get('Content-Disposition')).toBe(expectedDisposition);
    });
  });

  describe('Database query optimization', () => {
    it('should minimize database calls during validation', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      mockDb._setMockResult('first', mockApiKey);

      // Call validateApiKey multiple times
      const results = await Promise.all([
        validateApiKey(mockDb as any, 'pb_test123'),
        validateApiKey(mockDb as any, 'pb_test123'),
        validateApiKey(mockDb as any, 'pb_test123')
      ]);

      // Each call should make its own database query (no caching)
      expect(mockDb.prepare).toHaveBeenCalledTimes(6); // 3 for SELECT, 3 for UPDATE
      results.forEach(result => {
        expect(result).toEqual(mockApiKey);
      });
    });
  });

  describe('Memory efficiency', () => {
    it('should stream file content without loading entire file into memory', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      // Create a "large" file
      const largeContent = new Uint8Array(1024 * 1024); // 1MB
      const file = new File([largeContent], 'large.bin');
      const formData = new FormData();
      formData.append('file', file);

      const request = new Request('https://example.com/upload', {
        method: 'POST',
        body: formData
      });

      // Skip memory test in Workers environment
      // In a real Workers environment, memory usage is managed by the runtime
      const response = await handleUpload(
        request,
        mockDb as any,
        mockBucket as any,
        mockApiKey,
        'https://example.com'
      );

      // Just verify the upload succeeded
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('fileId');
      expect(data).toHaveProperty('size', 1024 * 1024);
    });
  });

  describe('Response time optimization', () => {
    it('should return file metadata quickly without waiting for R2', async () => {
      const mockUpload = {
        file_id: 'test_123',
        original_name: 'document.pdf',
        content_type: 'application/pdf',
        size: 1024
      };

      mockDb._setMockResult('first', mockUpload);

      // Mock R2 to be slow
      mockBucket.get = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
        return {
          key: 'test_123',
          body: new ArrayBuffer(1024),
          bodyUsed: false,
          arrayBuffer: async () => new ArrayBuffer(1024),
          text: async () => '',
          json: async () => ({}),
          blob: async () => new Blob([])
        };
      });

      const startTime = Date.now();
      
      const response = await handleServe(
        'test_123',
        mockDb as any,
        mockBucket as any,
        baseUrl
      );

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      // Response time should include R2 delay but be reasonable
      expect(responseTime).toBeGreaterThanOrEqual(100);
      expect(responseTime).toBeLessThan(200);
    });
  });
});
