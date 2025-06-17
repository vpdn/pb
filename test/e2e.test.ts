import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';
import { createMockEnv, createMockExecutionContext, createMockFormData } from './mocks';

// Mock nanoid with predictable sequence
let fileIdCounter = 0;
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => `e2e_file_${++fileIdCounter}`)
}));

describe('End-to-End Tests - Complete File Lifecycle', () => {
  let env: ReturnType<typeof createMockEnv>;
  let ctx: ExecutionContext;
  let apiKey1: any;
  let apiKey2: any;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockExecutionContext();
    fileIdCounter = 0; // Reset counter for each test
    
    apiKey1 = {
      id: 1,
      key: 'pb_user1_key',
      name: 'User 1 Key',
      created_at: '2024-01-01',
      last_used: null,
      is_active: 1
    };
    
    apiKey2 = {
      id: 2,
      key: 'pb_user2_key', 
      name: 'User 2 Key',
      created_at: '2024-01-01',
      last_used: null,
      is_active: 1
    };

    vi.clearAllMocks();
  });

  describe('Multi-user File Management Scenarios', () => {
    it('should handle complete workflow for multiple users with file isolation', async () => {
      // User 1 uploads a file
      env.DB._setMockResult('first', apiKey1);
      
      const user1File = createMockFormData([
        { name: 'user1-document.txt', content: 'User 1 private content', type: 'text/plain' }
      ]);

      const user1UploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_user1_key' },
        body: user1File
      });

      const user1UploadResponse = await worker.fetch(user1UploadRequest, env as any, ctx);
      expect(user1UploadResponse.status).toBe(200);
      
      const user1UploadData = await user1UploadResponse.json();
      const user1FileId = user1UploadData.fileId;

      // User 2 uploads a file  
      env.DB._setMockResult('first', apiKey2);
      
      const user2File = createMockFormData([
        { name: 'user2-document.txt', content: 'User 2 private content', type: 'text/plain' }
      ]);

      const user2UploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_user2_key' },
        body: user2File
      });

      const user2UploadResponse = await worker.fetch(user2UploadRequest, env as any, ctx);
      expect(user2UploadResponse.status).toBe(200);
      
      const user2UploadData = await user2UploadResponse.json();
      const user2FileId = user2UploadData.fileId;

      // Both users can retrieve their own files (no auth needed for retrieval)
      env.DB._setMockResult('first', {
        file_id: user1FileId,
        original_name: 'user1-document.txt',
        content_type: 'text/plain',
        size: 'User 1 private content'.length,
        api_key_id: 1
      });

      const user1RetrieveRequest = new Request(`https://example.com/f/${user1FileId}`, {
        method: 'GET'
      });

      const user1RetrieveResponse = await worker.fetch(user1RetrieveRequest, env as any, ctx);
      expect(user1RetrieveResponse.status).toBe(200);

      // User 1 tries to delete User 2's file (should fail)
      // Mock two different database queries:
      // 1. API key validation (should succeed for user1)
      // 2. File lookup (should fail - user1 doesn't own user2's file)
      let queryCount = 0;
      const mockPrepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(async () => {
          queryCount++;
          if (queryCount === 1) {
            // First query: API key validation - return valid key for user1
            return apiKey1;
          } else {
            // Second query: File lookup - return null (user1 doesn't own user2's file)
            return null;
          }
        }),
        run: vi.fn(),
        all: vi.fn()
      });
      env.DB.prepare = mockPrepare;

      const unauthorizedDeleteRequest = new Request(`https://example.com/f/${user2FileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer pb_user1_key' }
      });

      const unauthorizedDeleteResponse = await worker.fetch(unauthorizedDeleteRequest, env as any, ctx);
      expect(unauthorizedDeleteResponse.status).toBe(404);
      
      const unauthorizedDeleteData = await unauthorizedDeleteResponse.json();
      expect(unauthorizedDeleteData).toEqual({ error: 'File not found or access denied' });

      // User 2 successfully deletes their own file
      // Mock two different database queries:
      // 1. API key validation (should succeed for user2)
      // 2. File lookup (should succeed - user2 owns the file)
      let queryCount2 = 0;
      const mockPrepareSuccess = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(async () => {
          queryCount2++;
          if (queryCount2 === 1) {
            // First query: API key validation - return valid key for user2
            return apiKey2;
          } else {
            // Second query: File lookup - return the file (user2 owns it)
            return {
              file_id: user2FileId,
              original_name: 'user2-document.txt',
              content_type: 'text/plain',
              size: 'User 2 private content'.length,
              api_key_id: 2
            };
          }
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn()
      });
      env.DB.prepare = mockPrepareSuccess;

      const authorizedDeleteRequest = new Request(`https://example.com/f/${user2FileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer pb_user2_key' }
      });

      const authorizedDeleteResponse = await worker.fetch(authorizedDeleteRequest, env as any, ctx);
      expect(authorizedDeleteResponse.status).toBe(200);
      
      const authorizedDeleteData = await authorizedDeleteResponse.json();
      expect(authorizedDeleteData).toEqual({
        message: 'File deleted successfully',
        fileId: user2FileId
      });
    });

    it('should handle file replacement workflow', async () => {
      env.DB._setMockResult('first', apiKey1);

      // Upload initial file
      const initialFile = createMockFormData([
        { name: 'document.txt', content: 'Version 1 content', type: 'text/plain' }
      ]);

      const initialUploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_user1_key' },
        body: initialFile
      });

      const initialUploadResponse = await worker.fetch(initialUploadRequest, env as any, ctx);
      expect(initialUploadResponse.status).toBe(200);
      
      const initialUploadData = await initialUploadResponse.json();
      const initialFileId = initialUploadData.fileId;

      // Upload replacement file
      const replacementFile = createMockFormData([
        { name: 'document.txt', content: 'Version 2 content - updated', type: 'text/plain' }
      ]);

      const replacementUploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_user1_key' },
        body: replacementFile
      });

      const replacementUploadResponse = await worker.fetch(replacementUploadRequest, env as any, ctx);
      expect(replacementUploadResponse.status).toBe(200);
      
      const replacementUploadData = await replacementUploadResponse.json();
      const replacementFileId = replacementUploadData.fileId;

      // Verify both files exist and have different IDs
      expect(initialFileId).not.toBe(replacementFileId);
      expect(initialUploadData.size).toBe('Version 1 content'.length);
      expect(replacementUploadData.size).toBe('Version 2 content - updated'.length);

      // Delete old version
      const mockPrepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          file_id: initialFileId,
          original_name: 'document.txt',
          content_type: 'text/plain',
          size: 'Version 1 content'.length,
          api_key_id: 1
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn()
      });
      env.DB.prepare = mockPrepare;

      const deleteOldRequest = new Request(`https://example.com/f/${initialFileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer pb_user1_key' }
      });

      const deleteOldResponse = await worker.fetch(deleteOldRequest, env as any, ctx);
      expect(deleteOldResponse.status).toBe(200);

      // Reset the database mock to use the standard mock behavior
      env.DB.prepare = vi.fn(() => env.DB._getMockStatement());
      
      // Verify new version is still accessible
      env.DB._setMockResult('first', {
        file_id: replacementFileId,
        original_name: 'document.txt',
        content_type: 'text/plain',
        size: 'Version 2 content - updated'.length,
        api_key_id: 1
      });

      const retrieveNewRequest = new Request(`https://example.com/f/${replacementFileId}`, {
        method: 'GET'
      });

      const retrieveNewResponse = await worker.fetch(retrieveNewRequest, env as any, ctx);
      expect(retrieveNewResponse.status).toBe(200);
      expect(retrieveNewResponse.headers.get('Content-Length')).toBe('Version 2 content - updated'.length.toString());
    });

    it('should handle batch operations for multiple files', async () => {
      env.DB._setMockResult('first', apiKey1);

      const testFiles = [
        { name: 'doc1.txt', content: 'Document 1', type: 'text/plain' },
        { name: 'doc2.txt', content: 'Document 2', type: 'text/plain' },
        { name: 'doc3.txt', content: 'Document 3', type: 'text/plain' }
      ];

      const uploadedFiles = [];

      // Batch upload
      for (const file of testFiles) {
        const formData = createMockFormData([file]);
        const uploadRequest = new Request('https://example.com/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer pb_user1_key' },
          body: formData
        });

        const uploadResponse = await worker.fetch(uploadRequest, env as any, ctx);
        expect(uploadResponse.status).toBe(200);
        
        const uploadData = await uploadResponse.json();
        uploadedFiles.push({
          ...uploadData,
          originalName: file.name,
          contentType: file.type,
          originalContent: file.content
        });
      }

      expect(uploadedFiles).toHaveLength(3);

      // Batch retrieve - verify all files are accessible
      for (const uploadedFile of uploadedFiles) {
        env.DB._setMockResult('first', {
          file_id: uploadedFile.fileId,
          original_name: uploadedFile.originalName,
          content_type: uploadedFile.contentType,
          size: uploadedFile.size,
          api_key_id: 1
        });

        const retrieveRequest = new Request(`https://example.com/f/${uploadedFile.fileId}`, {
          method: 'GET'
        });

        const retrieveResponse = await worker.fetch(retrieveRequest, env as any, ctx);
        expect(retrieveResponse.status).toBe(200);
        expect(retrieveResponse.headers.get('Content-Disposition')).toBe(
          `inline; filename="${uploadedFile.originalName}"`
        );
      }

      // Batch delete - remove all files
      for (const uploadedFile of uploadedFiles) {
        const mockPrepare = vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({
            file_id: uploadedFile.fileId,
            original_name: uploadedFile.originalName,
            content_type: uploadedFile.contentType,
            size: uploadedFile.size,
            api_key_id: 1
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
          all: vi.fn()
        });
        env.DB.prepare = mockPrepare;

        const deleteRequest = new Request(`https://example.com/f/${uploadedFile.fileId}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer pb_user1_key' }
        });

        const deleteResponse = await worker.fetch(deleteRequest, env as any, ctx);
        expect(deleteResponse.status).toBe(200);
        
        const deleteData = await deleteResponse.json();
        expect(deleteData.fileId).toBe(uploadedFile.fileId);
      }
    });

    it('should handle error recovery scenarios', async () => {
      env.DB._setMockResult('first', apiKey1);

      // Test 1: Upload with storage failure, then retry
      const formData = createMockFormData([
        { name: 'test.txt', content: 'Test content', type: 'text/plain' }
      ]);

      // Mock R2 failure on first attempt
      env.R2_BUCKET.put = vi.fn().mockRejectedValueOnce(new Error('Storage temporarily unavailable'));

      const failedUploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_user1_key' },
        body: formData
      });

      const failedUploadResponse = await worker.fetch(failedUploadRequest, env as any, ctx);
      expect(failedUploadResponse.status).toBe(500);

      // Retry with working storage
      env.R2_BUCKET.put = vi.fn().mockResolvedValue({ key: 'e2e_file_2' });

      const retryFormData = createMockFormData([
        { name: 'test.txt', content: 'Test content', type: 'text/plain' }
      ]);

      const retryUploadRequest = new Request('https://example.com/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer pb_user1_key' },
        body: retryFormData
      });

      const retryUploadResponse = await worker.fetch(retryUploadRequest, env as any, ctx);
      expect(retryUploadResponse.status).toBe(200);

      const retryUploadData = await retryUploadResponse.json();

      // Test 2: Retrieve with temporary storage failure
      env.DB._setMockResult('first', {
        file_id: retryUploadData.fileId,
        original_name: 'test.txt',
        content_type: 'text/plain',
        size: 'Test content'.length,
        api_key_id: 1
      });

      // Mock R2 failure for retrieval
      env.R2_BUCKET.get = vi.fn().mockRejectedValueOnce(new Error('Storage temporarily unavailable'));

      const failedRetrieveRequest = new Request(`https://example.com/f/${retryUploadData.fileId}`, {
        method: 'GET'
      });

      const failedRetrieveResponse = await worker.fetch(failedRetrieveRequest, env as any, ctx);
      expect(failedRetrieveResponse.status).toBe(500);

      // Retry retrieval with working storage
      env.R2_BUCKET.get = vi.fn().mockResolvedValue({
        key: retryUploadData.fileId,
        body: new ArrayBuffer(12),
        bodyUsed: false,
        arrayBuffer: async () => new ArrayBuffer(12),
        text: async () => 'Test content',
        json: async () => ({}),
        blob: async () => new Blob(['Test content'])
      });

      const retryRetrieveRequest = new Request(`https://example.com/f/${retryUploadData.fileId}`, {
        method: 'GET'
      });

      const retryRetrieveResponse = await worker.fetch(retryRetrieveRequest, env as any, ctx);
      expect(retryRetrieveResponse.status).toBe(200);
    });

    it('should handle concurrent operations correctly', async () => {
      // Simulate concurrent uploads from the same user
      env.DB._setMockResult('first', apiKey1);

      const concurrentUploads = Array.from({ length: 5 }, (_, i) => {
        const formData = createMockFormData([
          { name: `concurrent-${i}.txt`, content: `Content ${i}`, type: 'text/plain' }
        ]);

        return worker.fetch(new Request('https://example.com/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer pb_user1_key' },
          body: formData
        }), env as any, ctx);
      });

      const uploadResults = await Promise.all(concurrentUploads);

      // All uploads should succeed
      uploadResults.forEach((response, i) => {
        expect(response.status).toBe(200);
      });

      const uploadData = await Promise.all(
        uploadResults.map(response => response.json())
      );

      // All files should have unique IDs
      const fileIds = uploadData.map(data => data.fileId);
      const uniqueFileIds = new Set(fileIds);
      expect(uniqueFileIds.size).toBe(5);

      // Verify all uploaded files can be retrieved
      for (let i = 0; i < uploadData.length; i++) {
        const data = uploadData[i];
        
        env.DB._setMockResult('first', {
          file_id: data.fileId,
          original_name: `concurrent-${i}.txt`,
          content_type: 'text/plain',
          size: data.size,
          api_key_id: 1
        });

        const retrieveRequest = new Request(`https://example.com/f/${data.fileId}`, {
          method: 'GET'
        });

        const retrieveResponse = await worker.fetch(retrieveRequest, env as any, ctx);
        expect(retrieveResponse.status).toBe(200);
      }
    });
  });
});