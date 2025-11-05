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

function encodeFileIdForUrl(fileId: string): string {
  return fileId
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
    return '';
  }

  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export async function handleServe(
  fileId: string,
  db: D1Database,
  bucket: R2Bucket,
  baseUrl?: string
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
      const directoryQuery = await db.prepare(
        `SELECT file_id, original_name, relative_path, size, content_type, uploaded_at, expires_at
         FROM uploads
         WHERE group_id = ?
         ORDER BY COALESCE(relative_path, original_name)`
      ).bind(fileId).all();

      if (!directoryQuery.success) {
        return new Response('Error serving file', { status: 500 });
      }

      if (!directoryQuery.results.length) {
        return new Response('File not found', { status: 404 });
      }

      const expirationCandidate = directoryQuery.results.find(
        (file: any) => file?.expires_at
      )?.expires_at as string | null | undefined;

      if (expirationCandidate) {
        const expirationDate = new Date(expirationCandidate);
        if (Number.isFinite(expirationDate.getTime()) && expirationDate < new Date()) {
          return new Response('File has expired', { status: 410 });
        }
      }

      const linkPrefix = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/f/`
        : '/f/';

      const listItems = directoryQuery.results.map((file: any) => {
        const displayName = file.relative_path || file.original_name || file.file_id;
        const sizeLabel = formatBytes(typeof file.size === 'number' ? file.size : undefined);
        const href = `${linkPrefix}${encodeFileIdForUrl(file.file_id)}`;

        return `<li>
          <a href="${escapeHtml(href)}">${escapeHtml(displayName)}</a>
          ${sizeLabel ? `<span class="file-size">${escapeHtml(sizeLabel)}</span>` : ''}
        </li>`;
      }).join('');

      const expiresLabel = expirationCandidate
        ? `<p class="expires">Expires: ${escapeHtml(new Date(expirationCandidate).toUTCString())}</p>`
        : '';

      const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Directory listing for ${escapeHtml(fileId)}</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 720px; padding: 0 1rem; color: #1f2933; background: #f8fafc; }
      h1 { font-size: 1.5rem; margin-bottom: 1rem; }
      ul { list-style: none; padding: 0; margin: 1.5rem 0; }
      li { background: #fff; margin-bottom: 0.75rem; padding: 0.75rem 1rem; border-radius: 0.5rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 5px 12px rgba(15, 23, 42, 0.06); gap: 1rem; }
      a { color: #2563eb; text-decoration: none; word-break: break-all; flex: 1; }
      a:hover { text-decoration: underline; }
      .file-size { color: #4b5563; font-size: 0.875rem; white-space: nowrap; }
      .meta { color: #475569; font-size: 0.95rem; }
      .expires { margin-top: 0.5rem; color: #b91c1c; }
      footer { margin-top: 2rem; font-size: 0.85rem; color: #64748b; }
      code { background: rgba(15,23,42,0.08); padding: 0.1rem 0.3rem; border-radius: 0.25rem; }
    </style>
  </head>
  <body>
    <header>
      <h1>Directory listing for <code>${escapeHtml(fileId)}</code></h1>
      <p class="meta">Select a file below to download it.</p>
      ${expiresLabel}
    </header>
    <main>
      <ul>
        ${listItems}
      </ul>
    </main>
    <footer>Generated by pb · Directory contains ${directoryQuery.results.length} file${directoryQuery.results.length === 1 ? '' : 's'}.</footer>
  </body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
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
