import { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { nanoid } from 'nanoid';
import { ApiKey } from './auth';

export interface UploadResponseFile {
  url: string;
  fileId: string;
  originalName: string;
  relativePath?: string;
  size: number;
  contentType?: string;
}

export interface UploadResponse {
  url: string;
  fileId: string;
  size: number;
  expiresAt?: string;
  isDirectory?: boolean;
  files?: UploadResponseFile[];
}

function sanitizeRelativePath(path: string): string {
  // Normalize slashes and remove leading ./ or ../ fragments
  let normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/').filter(Boolean);
  const safeSegments: string[] = [];

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      // Skip navigation segments to avoid escaping the folder
      continue;
    }
    safeSegments.push(segment);
  }

  return safeSegments.join('/');
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

const ISO_8601_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const MAX_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function normalizeExpiration(expiresAtRaw: string): string {
  const trimmed = expiresAtRaw.trim();

  if (!trimmed) {
    throw new Error('Invalid expires_at timestamp');
  }

  if (!ISO_8601_UTC_REGEX.test(trimmed)) {
    throw new Error('Invalid expires_at timestamp');
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Invalid expires_at timestamp');
  }

  const now = Date.now();
  const expiresAtMs = parsed.getTime();

  if (expiresAtMs <= now) {
    throw new Error('Expiration must be in the future');
  }

  if (expiresAtMs - now > MAX_EXPIRATION_MS) {
    throw new Error('Expiration must be within 30 days');
  }

  return parsed.toISOString();
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
    const files = formData.getAll('file').filter((file): file is File => file instanceof File);
    const expiresAtRaw = formData.get('expires_at');
    let expiresAt: string | null = null;
    const directoryFlag = formData.get('directory_upload') === 'true';

    if (!files.length) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (typeof expiresAtRaw === 'string' && expiresAtRaw.trim()) {
      try {
        expiresAt = normalizeExpiration(expiresAtRaw);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid expires_at timestamp';
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    const baseId = nanoid(12);
    const normalizedBaseUrl = stripTrailingSlash(baseUrl);

    const isDirectoryUpload =
      directoryFlag ||
      files.length > 1 ||
      files.some(file => sanitizeRelativePath(file.name).includes('/'));

    const uploadedFiles: UploadResponseFile[] = [];
    let totalSize = 0;

    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const relativePath = sanitizeRelativePath(file.name);
      const originalName = relativePath.split('/').pop() || file.name;
      const contentType = file.type || 'application/octet-stream';
      const objectKey = isDirectoryUpload
        ? `${baseId}/${relativePath}`
        : baseId;

      await bucket.put(objectKey, buffer, {
        httpMetadata: {
          contentType
        },
        customMetadata: {
          originalName: file.name,
          uploadedBy: apiKey.name,
          groupId: baseId,
          relativePath: isDirectoryUpload ? relativePath : ''
        }
      });

      await db.prepare(
        `INSERT INTO uploads (
          file_id,
          group_id,
          original_name,
          relative_path,
          size,
          content_type,
          api_key_id,
          expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        objectKey,
        baseId,
        originalName,
        isDirectoryUpload ? relativePath : null,
        file.size,
        contentType,
        apiKey.id,
        expiresAt
      ).run();

      totalSize += file.size;

      uploadedFiles.push({
        url: `${normalizedBaseUrl}/f/${objectKey}`,
        fileId: objectKey,
        originalName,
        relativePath: isDirectoryUpload ? relativePath : undefined,
        size: file.size,
        contentType: contentType || undefined
      });
    }

    const response: UploadResponse = {
      url: `${normalizedBaseUrl}/f/${isDirectoryUpload ? baseId : uploadedFiles[0].fileId}`,
      fileId: isDirectoryUpload ? baseId : uploadedFiles[0].fileId,
      size: totalSize || uploadedFiles[0].size
    };

    if (expiresAt) {
      response.expiresAt = expiresAt;
    }

    if (isDirectoryUpload) {
      response.isDirectory = true;
      response.files = uploadedFiles;
    } else {
      // Preserve previous response shape for single file uploads
      response.files = uploadedFiles;
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
