import { validateApiKey } from './auth';
import { handleUpload } from './upload';
import { handleServe } from './serve';
import { handleDelete } from './delete';
import { handleList } from './list';
import { cleanupExpiredFiles } from './cleanup';

export interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
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
      const fileId = url.pathname.split('/f/')[1];
      if (!fileId) {
        return new Response('File ID required', { status: 400 });
      }

      // Serve files (GET)
      if (request.method === 'GET') {
        return handleServe(fileId, env.DB, env.R2_BUCKET);
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

        return handleDelete(fileId, env.DB, env.R2_BUCKET, validKey);
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
      const baseUrl = url.hostname.includes('workers.dev') ? 'https://pb.nxh.ch' : url.origin;
      return handleUpload(request, env.DB, env.R2_BUCKET, validKey, baseUrl);
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

      return handleList(env.DB, validKey);
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