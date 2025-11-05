import { validateApiKey } from './auth';
import { handleUpload } from './upload';
import { handleServe } from './serve';
import { handleDelete } from './delete';
import { handleList } from './list';
import { cleanupExpiredFiles } from './cleanup';

export interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  PUBLIC_BASE_URL?: string;
  BASE_URL?: string;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveConfiguredBaseUrl(env: Env): string | null {
  const candidate = (env.PUBLIC_BASE_URL ?? env.BASE_URL ?? '').trim();
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    return stripTrailingSlash(parsed.toString());
  } catch {
    return stripTrailingSlash(candidate);
  }
}

function resolveBaseUrl(request: Request, env: Env): string {
  const configured = resolveConfiguredBaseUrl(env);
  if (configured) {
    return configured;
  }

  const url = new URL(request.url);
  return stripTrailingSlash(url.origin);
}

function applyCorsHeaders(response: Response, corsHeaders: Record<string, string>): Response {
  const headers = response.headers;
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const resolvedBaseUrl = resolveBaseUrl(request, env);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Handle file operations
    if (url.pathname.startsWith('/f/')) {
      const rawFileId = url.pathname.split('/f/')[1];
      if (!rawFileId) {
        return new Response('File ID required', { status: 400 });
      }

      // Decode the fileId to handle special characters and spaces
      const fileId = decodeURIComponent(rawFileId);

      // Serve files (GET)
      if (request.method === 'GET') {
        const response = await handleServe(fileId, env.DB, env.R2_BUCKET, resolvedBaseUrl);
        return applyCorsHeaders(response, corsHeaders);
      }

      // Delete files (DELETE)
      if (request.method === 'DELETE') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return new Response(JSON.stringify({ error: 'Authorization required' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const apiKey = authHeader.substring(7);
        const validKey = await validateApiKey(env.DB, apiKey);
        
        if (!validKey) {
          return new Response(JSON.stringify({ error: 'Invalid API key' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const response = await handleDelete(fileId, env.DB, env.R2_BUCKET, validKey);
        return applyCorsHeaders(response, corsHeaders);
      }

      // Method not allowed for /f/ endpoints
      return new Response('Method not allowed', { 
        status: 405,
        headers: { ...corsHeaders }
      });
    }

    // Handle uploads
    if (url.pathname === '/upload' && request.method === 'POST') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Authorization required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const apiKey = authHeader.substring(7);
      const validKey = await validateApiKey(env.DB, apiKey);
      
      if (!validKey) {
        return new Response(JSON.stringify({ error: 'Invalid API key' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Use custom domain if available, otherwise use request origin
      const response = await handleUpload(request, env.DB, env.R2_BUCKET, validKey, resolvedBaseUrl);
      return applyCorsHeaders(response, corsHeaders);
    }

    // Handle list files
    if (url.pathname === '/list' && request.method === 'GET') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Authorization required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const apiKey = authHeader.substring(7);
      const validKey = await validateApiKey(env.DB, apiKey);
      
      if (!validKey) {
        return new Response(JSON.stringify({ error: 'Invalid API key' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const response = await handleList(env.DB, validKey, resolvedBaseUrl);
      return applyCorsHeaders(response, corsHeaders);
    }

    // Default response
    return new Response('pb - Secure file upload service', {
      headers: { 'Content-Type': 'text/plain', ...corsHeaders }
    });
  },
  
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Running scheduled cleanup of expired files...');
    
    try {
      const result = await cleanupExpiredFiles(env.DB, env.R2_BUCKET);
      console.log(`Cleanup completed. Deleted ${result.deletedCount} expired files.`);
    } catch (error) {
      console.error('Scheduled cleanup failed:', error);
    }
  }
} satisfies ExportedHandler<Env>;
