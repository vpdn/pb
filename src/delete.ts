import { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { ApiKey } from './auth';

export async function handleDelete(
  fileId: string,
  db: D1Database,
  bucket: R2Bucket,
  apiKey: ApiKey
): Promise<Response> {
  try {
    // First check if the file exists and belongs to this API key
    const upload = await db
      .prepare('SELECT * FROM uploads WHERE file_id = ? AND api_key_id = ?')
      .bind(fileId, apiKey.id)
      .first();

    if (!upload) {
      return new Response(JSON.stringify({ error: 'File not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete from R2 storage
    await bucket.delete(fileId);

    // Delete from database
    await db
      .prepare('DELETE FROM uploads WHERE file_id = ? AND api_key_id = ?')
      .bind(fileId, apiKey.id)
      .run();

    return new Response(JSON.stringify({ 
      message: 'File deleted successfully',
      fileId: fileId 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete error:', error);
    return new Response(JSON.stringify({ error: 'Delete failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}