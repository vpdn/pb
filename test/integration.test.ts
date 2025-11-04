import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';
import { createMockEnv, createMockExecutionContext, createMockFormData } from './mocks';

// Mock nanoid to get predictable file IDs
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test_file_123')
}));

describe('Integration Tests - Upload and Retrieval Flow', () => {
  let env: ReturnType<typeof createMockEnv>;
  let ctx: ExecutionContext;
  let mockApiKey: any;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockExecutionContext();
    mockApiKey = {
      id: 1,
      key: 'pb_test123',
      name: 'Test Key',
      created_at: '2024-01-01',
      last_used: null,
      is_active: 1
    };

    // Mock API key validation to always return our test key
    env.DB._setMockResult('first', mockApiKey);
    
    vi.clearAllMocks();
  });

  describe('Complete File Upload and Retrieval Cycle', () => {
    it('should upload a file and then retrieve it successfully', async () => {
      // Step 1: Upload a file
      const fileContent = 'This is test file content for integration testing';
      const formData = createMockFormData([
        { name: 'test-document.txt', content: fileContent, type: 'text/plain' }
      ]);

      const uploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer pb_test123'
        },
        body: formData
      });

      const uploadResponse = await worker.fetch(uploadRequest, env as any, ctx);
      
      // Verify upload was successful
      expect(uploadResponse.status).toBe(200);
      
      const uploadData = await uploadResponse.json();
      expect(uploadData).toEqual({
        url: 'https://example.com/f/test_file_123',
        fileId: 'test_file_123',
        size: fileContent.length,
        files: [
          {
            url: 'https://example.com/f/test_file_123',
            fileId: 'test_file_123',
            originalName: 'test-document.txt',
            size: fileContent.length,
            contentType: 'text/plain'
          }
        ]
      });

      // Verify file was stored in R2
      expect(env.R2_BUCKET.put).toHaveBeenCalledWith(
        'test_file_123',
        expect.any(ArrayBuffer),
        expect.objectContaining({
          httpMetadata: {
            contentType: 'text/plain'
          },
          customMetadata: {
            originalName: 'test-document.txt',
            uploadedBy: 'Test Key',
            groupId: 'test_file_123',
            relativePath: ''
          }
        })
      );

      // Verify database record was created
      expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO uploads'));

      // Step 2: Retrieve the uploaded file
      // Mock the database to return the upload record for retrieval
      const uploadRecord = {
        file_id: 'test_file_123',
        original_name: 'test-document.txt',
        content_type: 'text/plain',
        size: fileContent.length,
        api_key_id: 1
      };
      
      env.DB._setMockResult('first', uploadRecord);

      const retrieveRequest = new Request('https://example.com/f/test_file_123', {
        method: 'GET'
      });

      const retrieveResponse = await worker.fetch(retrieveRequest, env as any, ctx);

      // Verify retrieval was successful
      expect(retrieveResponse.status).toBe(200);
      expect(retrieveResponse.headers.get('Content-Type')).toBe('text/plain');
      expect(retrieveResponse.headers.get('Content-Length')).toBe(fileContent.length.toString());
      expect(retrieveResponse.headers.get('Content-Disposition')).toBe('inline; filename="test-document.txt"');
      expect(retrieveResponse.headers.get('Cache-Control')).toBe('public, max-age=31536000');

      // Verify the correct file was requested from R2
      expect(env.R2_BUCKET.get).toHaveBeenCalledWith('test_file_123');
    });


    it('should prevent unauthorized access to files', async () => {
      // Upload a file with one API key
      const formData = createMockFormData([
        { name: 'private.txt', content: 'Secret content', type: 'text/plain' }
      ]);

      const uploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_test123' },
        body: formData
      });

      const uploadResponse = await worker.fetch(uploadRequest, env as any, ctx);
      expect(uploadResponse.status).toBe(200);

      // Try to delete with a different API key
      const differentApiKey = {
        id: 2,
        key: 'pb_different_key',
        name: 'Different Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      const deleteRequest = new Request('https://example.com/f/test_file_123', {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer pb_different_key' }
      });

      // Mock two different database queries:
      // 1. API key validation (should succeed for different key)
      // 2. File lookup (should fail - different user doesn't own the file)
      let queryCount = 0;
      const mockPrepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(async () => {
          queryCount++;
          if (queryCount === 1) {
            // First query: API key validation - return valid different key
            return differentApiKey;
          } else {
            // Second query: File lookup - return null (different user doesn't own the file)
            return null;
          }
        }),
        run: vi.fn(),
        all: vi.fn()
      });
      env.DB.prepare = mockPrepare;

      const deleteResponse = await worker.fetch(deleteRequest, env as any, ctx);

      expect(deleteResponse.status).toBe(404);
      const deleteData = await deleteResponse.json();
      expect(deleteData).toEqual({ error: 'File not found or access denied' });
    });

    it('should handle file upload, retrieval, and deletion lifecycle', async () => {
      // Step 1: Upload
      const fileContent = 'Lifecycle test content';
      const formData = createMockFormData([
        { name: 'lifecycle.txt', content: fileContent, type: 'text/plain' }
      ]);

      const uploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_test123' },
        body: formData
      });

      const uploadResponse = await worker.fetch(uploadRequest, env as any, ctx);
      expect(uploadResponse.status).toBe(200);

      const uploadData = await uploadResponse.json();
      const fileId = uploadData.fileId;

      // Step 2: Retrieve
      env.DB._setMockResult('first', {
        file_id: fileId,
        original_name: 'lifecycle.txt',
        content_type: 'text/plain',
        size: fileContent.length,
        api_key_id: 1
      });

      const retrieveRequest = new Request(`https://example.com/f/${fileId}`, {
        method: 'GET'
      });

      const retrieveResponse = await worker.fetch(retrieveRequest, env as any, ctx);
      expect(retrieveResponse.status).toBe(200);

      // Step 3: Delete
      env.DB._setMockResult('first', {
        file_id: fileId,
        original_name: 'lifecycle.txt',
        content_type: 'text/plain',
        size: fileContent.length,
        api_key_id: 1
      });

      const deleteRequest = new Request(`https://example.com/f/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer pb_test123' }
      });

      const deleteResponse = await worker.fetch(deleteRequest, env as any, ctx);
      expect(deleteResponse.status).toBe(200);

      const deleteData = await deleteResponse.json();
      expect(deleteData).toEqual({
        message: 'File deleted successfully',
        fileId: fileId
      });

      // Verify deletion operations were called
      expect(env.R2_BUCKET.delete).toHaveBeenCalledWith(fileId);
      expect(env.DB.prepare).toHaveBeenCalledWith(
        'DELETE FROM uploads WHERE file_id = ? AND api_key_id = ?'
      );

      // Step 4: Try to retrieve deleted file
      env.DB._setMockResult('first', null); // File no longer exists in DB

      const retrieveDeletedRequest = new Request(`https://example.com/f/${fileId}`, {
        method: 'GET'
      });

      const retrieveDeletedResponse = await worker.fetch(retrieveDeletedRequest, env as any, ctx);
      expect(retrieveDeletedResponse.status).toBe(404);
    });

    it('should handle large file uploads and retrievals', async () => {
      const largeContent = 'x'.repeat(5 * 1024 * 1024); // 5MB
      const formData = createMockFormData([
        { name: 'large-file.bin', content: largeContent, type: 'application/octet-stream' }
      ]);

      const uploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_test123' },
        body: formData
      });

      const uploadResponse = await worker.fetch(uploadRequest, env as any, ctx);
      expect(uploadResponse.status).toBe(200);

      const uploadData = await uploadResponse.json();
      expect(uploadData.size).toBe(5 * 1024 * 1024);

      // Verify large file can be retrieved
      env.DB._setMockResult('first', {
        file_id: uploadData.fileId,
        original_name: 'large-file.bin',
        content_type: 'application/octet-stream',
        size: largeContent.length,
        api_key_id: 1
      });

      const retrieveRequest = new Request(`https://example.com/f/${uploadData.fileId}`, {
        method: 'GET'
      });

      const retrieveResponse = await worker.fetch(retrieveRequest, env as any, ctx);
      expect(retrieveResponse.status).toBe(200);
      expect(retrieveResponse.headers.get('Content-Length')).toBe((5 * 1024 * 1024).toString());
    });

  });
});
