import { D1Database, R2Bucket } from '@cloudflare/workers-types';

function shouldDisplayInline(contentType: string): boolean {
  // Content types that should be displayed inline in browser
  const inlineTypes = [
    // Text files
    'text/',
    // Images
    'image/',
    // Web documents
    'text/html',
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/json',
    'application/xml',
    // PDFs
    'application/pdf',
    // Audio/Video (for browser players)
    'audio/',
    'video/',
    // Web fonts
    'font/',
    'application/font-',
    // SVG
    'image/svg+xml'
  ];
  
  return inlineTypes.some(type => contentType.toLowerCase().startsWith(type.toLowerCase()));
}

export async function handleServe(
  fileId: string,
  db: D1Database,
  bucket: R2Bucket
): Promise<Response> {
  try {
    const upload = await db.prepare(
      'SELECT * FROM uploads WHERE file_id = ?'
    ).bind(fileId).first<{
      file_id: string;
      original_name: string;
      content_type: string;
      size: number;
      expires_at: string | null;
    }>();

    if (!upload) {
      return new Response('File not found', { status: 404 });
    }

    // Check if file has expired
    if (upload.expires_at) {
      const expirationDate = new Date(upload.expires_at);
      if (expirationDate < new Date()) {
        return new Response('File has expired', { status: 410 }); // 410 Gone
      }
    }

    const object = await bucket.get(fileId);

    if (!object) {
      return new Response('File not found in storage', { status: 404 });
    }

    // Update last_accessed_at timestamp and increment access counter atomically
    // Using access_count = access_count + 1 ensures atomic increment (no race condition)
    await db.prepare(
      'UPDATE uploads SET last_accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1 WHERE file_id = ?'
    ).bind(fileId).run();

    const headers = new Headers();
    const contentType = upload.content_type || 'application/octet-stream';
    
    headers.set('Content-Type', contentType);
    headers.set('Content-Length', upload.size.toString());
    headers.set('Cache-Control', 'public, max-age=31536000');
    
    // Set Content-Disposition based on file type for better browser handling
    if (shouldDisplayInline(contentType)) {
      headers.set('Content-Disposition', `inline; filename="${upload.original_name}"`);
    } else {
      headers.set('Content-Disposition', `attachment; filename="${upload.original_name}"`);
    }
    
    return new Response(object.body, {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('Serve error:', error);
    return new Response('Error serving file', { status: 500 });
  }
}