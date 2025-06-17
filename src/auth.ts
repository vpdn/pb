import { D1Database } from '@cloudflare/workers-types';

export interface ApiKey {
  id: number;
  key: string;
  name: string;
  created_at: string;
  last_used: string | null;
  is_active: number;
}

export async function validateApiKey(db: D1Database, apiKey: string): Promise<ApiKey | null> {
  try {
    const result = await db.prepare(
      'SELECT * FROM api_keys WHERE key = ? AND is_active = 1'
    ).bind(apiKey).first<ApiKey>();

    if (result) {
      await db.prepare(
        'UPDATE api_keys SET last_used = datetime("now") WHERE id = ?'
      ).bind(result.id).run();
    }

    return result;
  } catch (error) {
    console.error('Error validating API key:', error);
    return null;
  }
}

export async function createApiKey(db: D1Database, name: string): Promise<string> {
  const apiKey = generateApiKey();
  
  await db.prepare(
    'INSERT INTO api_keys (key, name) VALUES (?, ?)'
  ).bind(apiKey, name).run();
  
  return apiKey;
}

function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'pb_';
  
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return key;
}