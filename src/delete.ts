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

    if (upload) {
      // Delete single file
      await bucket.delete(fileId);

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
    }

    // If no single file was found, attempt to delete an entire group/folder
    const folderQuery = await db
      .prepare('SELECT file_id FROM uploads WHERE group_id = ? AND api_key_id = ?')
      .bind(fileId, apiKey.id)
      .all();

    const isResultObject = folderQuery && typeof folderQuery === 'object' && 'results' in folderQuery;
    const folderSuccess = isResultObject ? (folderQuery as any).success !== false : true;
    const folderResults = Array.isArray(folderQuery)
      ? folderQuery
      : isResultObject
        ? (folderQuery as any).results
        : [];

    if (!folderSuccess) {
      return new Response(JSON.stringify({ error: 'Delete failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (folderResults.length > 0) {
      const fileIds = folderResults.map((row: any) => row.file_id as string);

      for (const key of fileIds) {
        await bucket.delete(key);
      }

      await db
        .prepare('DELETE FROM uploads WHERE group_id = ? AND api_key_id = ?')
        .bind(fileId, apiKey.id)
        .run();

      return new Response(JSON.stringify({
        message: 'Folder deleted successfully',
        fileId,
        deletedCount: fileIds.length
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'File not found or access denied' }), {
      status: 404,
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
