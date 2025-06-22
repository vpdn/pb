import { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import { ApiKey } from './auth';

export interface UploadResponse {
  url: string;
  fileId: string;
  size: number;
  expiresAt?: string;
}

export async function handleUpload(
  request: Request,
  db: D1Database,
  bucket: R2Bucket,
  apiKey: ApiKey,
  baseUrl: string
): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const expiresAt = formData.get('expires_at') as string | null;
    
    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const fileId = nanoid(12);
    const buffer = await file.arrayBuffer();
    
    await bucket.put(fileId, buffer, {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream'
      },
      customMetadata: {
        originalName: file.name,
        uploadedBy: apiKey.name
      }
    });

    await db.prepare(
      'INSERT INTO uploads (file_id, original_name, size, content_type, api_key_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(fileId, file.name, file.size, file.type, apiKey.id, expiresAt).run();

    const response: UploadResponse = {
      url: `${baseUrl}/f/${fileId}`,
      fileId,
      size: file.size
    };
    
    if (expiresAt) {
      response.expiresAt = expiresAt;
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ error: 'Upload failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}