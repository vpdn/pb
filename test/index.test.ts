import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';
import { createMockEnv, createMockExecutionContext, createMockFormData } from './mocks';

// Mock the imported modules
vi.mock('../src/auth', () => ({
  validateApiKey: vi.fn()
}));

vi.mock('../src/upload', () => ({
  handleUpload: vi.fn()
}));

vi.mock('../src/serve', () => ({
  handleServe: vi.fn()
}));

vi.mock('../src/delete', () => ({
  handleDelete: vi.fn()
}));

vi.mock('../src/list', () => ({
  handleList: vi.fn()
}));

import { validateApiKey } from '../src/auth';
import { handleUpload } from '../src/upload';
import { handleServe } from '../src/serve';
import { handleDelete } from '../src/delete';
import { handleList } from '../src/list';

describe('Main Worker', () => {
  let env: ReturnType<typeof createMockEnv>;
  let ctx: ExecutionContext;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockExecutionContext();
    vi.clearAllMocks();
  });

  describe('CORS handling', () => {
    it('should handle OPTIONS preflight requests', async () => {
      const request = new Request('https://example.com/upload', {
        method: 'OPTIONS'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization');
    });

    it('should include CORS headers in responses', async () => {
      const request = new Request('https://example.com/', {
        method: 'GET'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('File serving endpoint', () => {
    it('should serve files at /f/:fileId', async () => {
      const mockResponse = new Response('file content', {
        headers: { 'Content-Type': 'application/pdf' }
      });
      vi.mocked(handleServe).mockResolvedValue(mockResponse);

      const request = new Request('https://example.com/f/test123', {
        method: 'GET'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(handleServe).toHaveBeenCalledWith('test123', env.DB, env.R2_BUCKET);
      expect(response).toBe(mockResponse);
    });

    it('should return 400 for missing file ID', async () => {
      const request = new Request('https://example.com/f/', {
        method: 'GET'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe('File ID required');
      expect(handleServe).not.toHaveBeenCalled();
    });

    it('should handle DELETE requests for files', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      vi.mocked(validateApiKey).mockResolvedValue(mockApiKey);

      const mockDeleteResponse = new Response(JSON.stringify({
        message: 'File deleted successfully',
        fileId: 'test123'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      vi.mocked(handleDelete).mockResolvedValue(mockDeleteResponse);

      const request = new Request('https://example.com/f/test123', {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer pb_test123'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(validateApiKey).toHaveBeenCalledWith(env.DB, 'pb_test123');
      expect(handleDelete).toHaveBeenCalledWith('test123', env.DB, env.R2_BUCKET, mockApiKey);
      expect(response).toBe(mockDeleteResponse);
    });

    it('should require authorization for DELETE requests', async () => {
      const request = new Request('https://example.com/f/test123', {
        method: 'DELETE'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: 'Authorization required' });
      expect(handleDelete).not.toHaveBeenCalled();
    });

    it('should validate API key for DELETE requests', async () => {
      vi.mocked(validateApiKey).mockResolvedValue(null);

      const request = new Request('https://example.com/f/test123', {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer invalid_key'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({ error: 'Invalid API key' });
      expect(handleDelete).not.toHaveBeenCalled();
    });

    it('should return 405 for unsupported methods on /f/ endpoints', async () => {
      const request = new Request('https://example.com/f/test123', {
        method: 'POST'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(405);
      const text = await response.text();
      expect(text).toBe('Method not allowed');
    });
  });

  describe('List endpoint', () => {
    it('should require authorization header', async () => {
      const request = new Request('https://example.com/list', {
        method: 'GET'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: 'Authorization required' });
      expect(handleList).not.toHaveBeenCalled();
    });

    it('should validate Bearer token format', async () => {
      const request = new Request('https://example.com/list', {
        method: 'GET',
        headers: {
          'Authorization': 'InvalidFormat token123'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: 'Authorization required' });
      expect(handleList).not.toHaveBeenCalled();
    });

    it('should validate API key and handle list request', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      vi.mocked(validateApiKey).mockResolvedValue(mockApiKey);

      const mockListResponse = new Response(JSON.stringify({
        files: [
          {
            fileId: 'abc123',
            originalName: 'test.txt',
            size: 12,
            contentType: 'text/plain',
            uploadedAt: '2023-12-01T10:30:00.000Z',
            url: 'https://pb.nxh.ch/f/abc123'
          }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      vi.mocked(handleList).mockResolvedValue(mockListResponse);

      const request = new Request('https://example.com/list', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer pb_test123'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(validateApiKey).toHaveBeenCalledWith(env.DB, 'pb_test123');
      expect(handleList).toHaveBeenCalledWith(env.DB, mockApiKey);
      expect(response).toBe(mockListResponse);
    });

    it('should reject invalid API keys', async () => {
      vi.mocked(validateApiKey).mockResolvedValue(null);

      const request = new Request('https://example.com/list', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer invalid_key'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({ error: 'Invalid API key' });
      expect(handleList).not.toHaveBeenCalled();
    });

    it('should only accept GET method for list endpoint', async () => {
      const request = new Request('https://example.com/list', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer pb_test123'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('pb - Secure file upload service');
      expect(handleList).not.toHaveBeenCalled();
    });
  });

  describe('Upload endpoint', () => {
    it('should require authorization header', async () => {
      const request = new Request('https://example.com/upload', {
        method: 'POST'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: 'Authorization required' });
    });

    it('should validate Bearer token format', async () => {
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'InvalidFormat token123'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: 'Authorization required' });
    });

    it('should validate API key and handle upload', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      vi.mocked(validateApiKey).mockResolvedValue(mockApiKey);

      const mockUploadResponse = new Response(JSON.stringify({
        url: 'https://example.com/f/abc123',
        fileId: 'abc123',
        size: 1024
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

      vi.mocked(handleUpload).mockResolvedValue(mockUploadResponse);

      const formData = createMockFormData([
        { name: 'test.pdf', content: 'file content' }
      ]);

      const request = new Request('https://example.com/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer pb_test123'
        },
        body: formData
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(validateApiKey).toHaveBeenCalledWith(env.DB, 'pb_test123');
      expect(handleUpload).toHaveBeenCalledWith(
        request,
        env.DB,
        env.R2_BUCKET,
        mockApiKey,
        'https://example.com'
      );
      expect(response).toBe(mockUploadResponse);
    });

    it('should reject invalid API keys', async () => {
      vi.mocked(validateApiKey).mockResolvedValue(null);

      const request = new Request('https://example.com/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid_key'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({ error: 'Invalid API key' });
      expect(handleUpload).not.toHaveBeenCalled();
    });

    it('should only accept POST method for uploads', async () => {
      const request = new Request('https://example.com/upload', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer pb_test123'
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('pb - Secure file upload service');
      expect(validateApiKey).not.toHaveBeenCalled();
    });
  });

  describe('Default route', () => {
    it('should return service info for root path', async () => {
      const request = new Request('https://example.com/', {
        method: 'GET'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('pb - Secure file upload service');
      expect(response.headers.get('Content-Type')).toBe('text/plain');
    });

    it('should return service info for unknown paths', async () => {
      const request = new Request('https://example.com/unknown/path', {
        method: 'GET'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('pb - Secure file upload service');
    });
  });

  describe('URL handling', () => {
    it('should handle URLs with query parameters correctly', async () => {
      const mockResponse = new Response('file content');
      vi.mocked(handleServe).mockResolvedValue(mockResponse);

      const request = new Request('https://example.com/f/test123?download=true', {
        method: 'GET'
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(handleServe).toHaveBeenCalledWith('test123', env.DB, env.R2_BUCKET);
    });

    it('should preserve protocol in upload responses', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      vi.mocked(validateApiKey).mockResolvedValue(mockApiKey);
      vi.mocked(handleUpload).mockImplementation(async (req, db, bucket, key, baseUrl) => {
        return new Response(JSON.stringify({ baseUrl }));
      });

      const request = new Request('http://localhost:8787/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer pb_test123'
        },
        body: new FormData()
      });

      await worker.fetch(request, env as any, ctx);

      expect(handleUpload).toHaveBeenCalledWith(
        expect.any(Request),
        env.DB,
        env.R2_BUCKET,
        mockApiKey,
        'http://localhost:8787'
      );
    });
  });
});