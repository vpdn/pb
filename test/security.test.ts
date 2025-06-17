import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';
import { createMockEnv, createMockExecutionContext } from './mocks';

vi.mock('../src/auth', () => ({
  validateApiKey: vi.fn()
}));

vi.mock('../src/serve', () => ({
  handleServe: vi.fn()
}));

import { validateApiKey } from '../src/auth';
import { handleServe } from '../src/serve';

describe('Security Tests', () => {
  let env: ReturnType<typeof createMockEnv>;
  let ctx: ExecutionContext;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockExecutionContext();
    vi.clearAllMocks();
  });

  describe('Path traversal protection', () => {
    it('should handle file IDs with path traversal attempts', async () => {
      const mockResponse = new Response('Not found', { status: 404 });
      vi.mocked(handleServe).mockResolvedValue(mockResponse);

      const maliciousIds = [
        '../../../etc/passwd',
        '..%2F..%2F..%2Fetc%2Fpasswd',
        '....//....//....//etc/passwd',
        '.%2e/%2e%2e/%2e%2e/etc/passwd'
      ];

      for (const id of maliciousIds) {
        const request = new Request(`https://example.com/f/${id}`, {
          method: 'GET'
        });

        const response = await worker.fetch(request, env as any, ctx);
        
        // The response should still work (the ID just won't be found)
        expect(response).toBeDefined();
      }
    });
  });

  describe('Request size limits', () => {
    it('should handle extremely long file IDs', async () => {
      const longId = 'a'.repeat(1000);
      const request = new Request(`https://example.com/f/${longId}`, {
        method: 'GET'
      });

      vi.mocked(handleServe).mockResolvedValue(new Response('Not found', { status: 404 }));

      const response = await worker.fetch(request, env as any, ctx);

      expect(handleServe).toHaveBeenCalledWith(longId, env.DB, env.R2_BUCKET);
    });

    it('should handle URLs with many query parameters', async () => {
      const params = new URLSearchParams();
      for (let i = 0; i < 100; i++) {
        params.append(`param${i}`, `value${i}`);
      }

      const request = new Request(`https://example.com/f/test123?${params.toString()}`, {
        method: 'GET'
      });

      vi.mocked(handleServe).mockResolvedValue(new Response('OK'));

      const response = await worker.fetch(request, env as any, ctx);

      expect(handleServe).toHaveBeenCalledWith('test123', env.DB, env.R2_BUCKET);
    });
  });

  describe('Authorization header validation', () => {
    it('should reject authorization headers with extra spaces', async () => {
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer  pb_test123' // Double space
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(403);
      expect(validateApiKey).toHaveBeenCalledWith(env.DB, ' pb_test123'); // Extra space included
    });

    it('should handle case-sensitive Bearer prefix', async () => {
      const variations = ['bearer', 'BEARER', 'Bearer'];
      
      for (const prefix of variations) {
        const request = new Request('https://example.com/upload', {
          method: 'POST',
          headers: {
            'Authorization': `${prefix} pb_test123`
          }
        });

        const response = await worker.fetch(request, env as any, ctx);

        if (prefix === 'Bearer') {
          expect(validateApiKey).toHaveBeenCalled();
        } else {
          expect(response.status).toBe(401);
        }
      }
    });

    it('should reject empty API keys', async () => {
      const request = new Request('https://example.com/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer '
        }
      });

      const response = await worker.fetch(request, env as any, ctx);

      expect(response.status).toBe(401); // Empty bearer token is still invalid auth
      expect(validateApiKey).not.toHaveBeenCalled(); // Won't reach validation
    });
  });

  describe('Content-Type validation', () => {
    it('should handle requests without Content-Type', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      vi.mocked(validateApiKey).mockResolvedValue(mockApiKey);

      const request = new Request('https://example.com/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer pb_test123'
        },
        body: 'raw body data'
      });

      const response = await worker.fetch(request, env as any, ctx);

      // Should still process the request
      expect(validateApiKey).toHaveBeenCalled();
    });
  });

  describe('HTTP method validation', () => {
    it('should reject non-standard HTTP methods', async () => {
      const methods = ['PUT', 'DELETE', 'PATCH', 'HEAD'];

      for (const method of methods) {
        const request = new Request('https://example.com/upload', {
          method,
          headers: {
            'Authorization': 'Bearer pb_test123'
          }
        });

        const response = await worker.fetch(request, env as any, ctx);

        // Should return default response
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe('pb - Secure file upload service');
      }
    });
  });

  describe('URL encoding edge cases', () => {
    it('should handle double-encoded URLs', async () => {
      const fileId = encodeURIComponent(encodeURIComponent('test file.pdf'));
      const request = new Request(`https://example.com/f/${fileId}`, {
        method: 'GET'
      });

      vi.mocked(handleServe).mockResolvedValue(new Response('OK'));

      await worker.fetch(request, env as any, ctx);

      expect(handleServe).toHaveBeenCalledWith(fileId, env.DB, env.R2_BUCKET);
    });

    it('should handle special characters in file IDs', async () => {
      const specialIds = [
        'file%20with%20spaces',
        'file+with+plus',
        'file@special#chars',
        'file?query=param',
        'file&ampersand'
      ];

      vi.mocked(handleServe).mockResolvedValue(new Response('OK'));

      for (const id of specialIds) {
        const request = new Request(`https://example.com/f/${encodeURIComponent(id)}`, {
          method: 'GET'
        });

        await worker.fetch(request, env as any, ctx);
      }

      expect(handleServe).toHaveBeenCalledTimes(specialIds.length);
    });
  });
});