import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateApiKey, createApiKey } from '../src/auth';
import { createMockD1Database } from './mocks';

describe('Auth Module', () => {
  let mockDb: ReturnType<typeof createMockD1Database>;

  beforeEach(() => {
    mockDb = createMockD1Database();
    vi.clearAllMocks();
  });

  describe('validateApiKey', () => {
    it('should return valid API key when found and active', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      mockDb._setMockResult('first', mockApiKey);

      const result = await validateApiKey(mockDb as any, 'pb_test123');

      expect(result).toEqual(mockApiKey);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        'SELECT * FROM api_keys WHERE key = ? AND is_active = 1'
      );
      expect(mockDb._getMockStatement().bind).toHaveBeenCalledWith('pb_test123');
    });

    it('should update last_used timestamp when key is valid', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 1
      };

      mockDb._setMockResult('first', mockApiKey);

      await validateApiKey(mockDb as any, 'pb_test123');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        'UPDATE api_keys SET last_used = datetime("now") WHERE id = ?'
      );
      expect(mockDb._getMockStatement().bind).toHaveBeenCalledWith(1);
      expect(mockDb._getMockStatement().run).toHaveBeenCalled();
    });

    it('should return null when API key is not found', async () => {
      mockDb._setMockResult('first', null);

      const result = await validateApiKey(mockDb as any, 'invalid_key');

      expect(result).toBeNull();
    });

    it('should return null when API key is inactive', async () => {
      const mockApiKey = {
        id: 1,
        key: 'pb_test123',
        name: 'Test Key',
        created_at: '2024-01-01',
        last_used: null,
        is_active: 0
      };

      mockDb._setMockResult('first', null); // Simulating that the query with is_active = 1 returns nothing

      const result = await validateApiKey(mockDb as any, 'pb_test123');

      expect(result).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      mockDb.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = await validateApiKey(mockDb as any, 'pb_test123');

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error validating API key:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('createApiKey', () => {
    it('should create a new API key with proper format', async () => {
      const name = 'New API Key';
      
      const result = await createApiKey(mockDb as any, name);

      expect(result).toMatch(/^pb_[A-Za-z0-9]{32}$/);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        'INSERT INTO api_keys (key, name) VALUES (?, ?)'
      );
      expect(mockDb._getMockStatement().bind).toHaveBeenCalledWith(
        expect.stringMatching(/^pb_[A-Za-z0-9]{32}$/),
        name
      );
      expect(mockDb._getMockStatement().run).toHaveBeenCalled();
    });

    it('should generate unique keys on multiple calls', async () => {
      const key1 = await createApiKey(mockDb as any, 'Key 1');
      const key2 = await createApiKey(mockDb as any, 'Key 2');

      expect(key1).not.toEqual(key2);
      expect(key1).toMatch(/^pb_/);
      expect(key2).toMatch(/^pb_/);
    });
  });
});