import { D1Database, R2Bucket } from '@cloudflare/workers-types';

export async function cleanupExpiredFiles(
  db: D1Database,
  bucket: R2Bucket
): Promise<{ deletedCount: number }> {
  const batchSize = 100; // Process 100 files at a time to stay within CPU limits
  let deletedCount = 0;
  
  try {
    // Query expired files in batches
    const expiredFiles = await db.prepare(`
      SELECT file_id, original_name 
      FROM uploads 
      WHERE expires_at IS NOT NULL 
        AND datetime(expires_at) <= datetime('now')
      LIMIT ?
    `).bind(batchSize).all();

    if (!expiredFiles.success || expiredFiles.results.length === 0) {
      return { deletedCount: 0 };
    }

    // Delete files from R2 and database
    for (const file of expiredFiles.results) {
      try {
        // Delete from R2 storage
        await bucket.delete(file.file_id as string);
        
        // Delete from database
        await db.prepare(
          'DELETE FROM uploads WHERE file_id = ?'
        ).bind(file.file_id).run();
        
        deletedCount++;
        console.log(`Deleted expired file: ${file.file_id} (${file.original_name})`);
      } catch (error) {
        console.error(`Failed to delete file ${file.file_id}:`, error);
      }
    }

    return { deletedCount };
  } catch (error) {
    console.error('Cleanup error:', error);
    return { deletedCount };
  }
}
