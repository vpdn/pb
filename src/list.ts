export async function handleList(db: D1Database, apiKey: { id: number; key: string }): Promise<Response> {
  try {
    // Query uploads table for files uploaded by this API key
    const result = await db.prepare(`
      SELECT 
        file_id,
        original_name,
        size,
        content_type,
        uploaded_at,
        expires_at
      FROM uploads 
      WHERE api_key_id = ? 
      ORDER BY uploaded_at DESC
    `).bind(apiKey.id).all();

    if (!result.success) {
      return new Response(JSON.stringify({ error: 'Database query failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Format the results to include file URLs
    const files = result.results.map((file: any) => {
      const fileInfo: any = {
        fileId: file.file_id,
        originalName: file.original_name,
        size: file.size,
        contentType: file.content_type,
        uploadedAt: file.uploaded_at,
        url: `https://pb.nxh.ch/f/${file.file_id}` // Using the custom domain from the CLI
      };
      
      if (file.expires_at) {
        fileInfo.expiresAt = file.expires_at;
        
        // Calculate remaining time
        const now = new Date();
        const expiresAt = new Date(file.expires_at);
        const remainingMs = expiresAt.getTime() - now.getTime();
        
        if (remainingMs > 0) {
          const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
          const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
          const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
          
          let remainingTime = '';
          if (days > 0) remainingTime += `${days}d `;
          if (hours > 0) remainingTime += `${hours}h `;
          if (minutes > 0 || (days === 0 && hours === 0)) remainingTime += `${minutes}m`;
          
          fileInfo.remainingTime = remainingTime.trim();
        } else {
          fileInfo.remainingTime = 'expired';
        }
      }
      
      return fileInfo;
    });

    return new Response(JSON.stringify({ files }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error listing files:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}