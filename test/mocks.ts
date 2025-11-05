import { vi } from 'vitest';

export function createMockD1Database() {
  const mockResults = new Map<string, any>();
  
  const mockStmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(async () => mockResults.get('first')),
    run: vi.fn(async () => ({ success: true })),
    all: vi.fn(async () => mockResults.get('all') || { success: true, results: [] })
  };

  const db = {
    prepare: vi.fn(() => mockStmt),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
    _setMockResult: (type: string, result: any) => {
      mockResults.set(type, result);
    },
    _getMockStatement: () => mockStmt
  };

  return db;
}

export function createMockR2Bucket() {
  const mockStorage = new Map<string, any>();
  
  const bucket = {
    put: vi.fn(async (key: string, value: any, options?: any) => {
      mockStorage.set(key, { value, options });
      return { key };
    }),
    get: vi.fn(async (key: string) => {
      const stored = mockStorage.get(key);
      if (!stored) return null;
      
      return {
        key,
        body: stored.value,
        bodyUsed: false,
        arrayBuffer: async () => stored.value,
        text: async () => stored.value.toString(),
        json: async () => JSON.parse(stored.value.toString()),
        blob: async () => new Blob([stored.value])
      };
    }),
    delete: vi.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    list: vi.fn(async () => ({
      objects: Array.from(mockStorage.keys()).map(key => ({ key }))
    })),
    _getStorage: () => mockStorage
  };

  return bucket;
}

export function createMockRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
) {
  const { method = 'GET', headers = {}, body } = options;
  
  const request = new Request(url, {
    method,
    headers: new Headers(headers),
    body: body instanceof FormData ? body : JSON.stringify(body)
  });

  return request;
}

export function createMockFormData(
  files: { name: string; content: string | ArrayBuffer; type?: string }[],
  options: { directoryUpload?: boolean; expiresAt?: string } = {}
) {
  const formData = new FormData();
  
  files.forEach(({ name, content, type = 'application/octet-stream' }) => {
    const blob = new Blob([content], { type });
    const file = new File([blob], name, { type });
    formData.append('file', file);
  });

  if (options.expiresAt) {
    formData.append('expires_at', options.expiresAt);
  }

  if (options.directoryUpload) {
    formData.append('directory_upload', 'true');
  }

  return formData;
}

export function createMockEnv(overrides: Partial<{
  PUBLIC_BASE_URL: string;
  BASE_URL: string;
}> = {}) {
  return {
    DB: createMockD1Database(),
    R2_BUCKET: createMockR2Bucket(),
    JWT_SECRET: 'test-secret',
    ...overrides
  };
}

export function createMockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn()
  };
}

export function buildExpectedContentDisposition(
  filename: string,
  disposition: 'inline' | 'attachment' = 'inline'
): string {
  const sanitized = filename
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\\/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .trim();

  const fallback = sanitized ? (sanitized.length > 150 ? sanitized.slice(0, 150) : sanitized) : 'download';

  const encoded = encodeURIComponent(filename)
    .replace(/\*/g, '%2A')
    .replace(/%(7C|60|5E)/gi, match => match.toUpperCase());

  const encodedPart = encoded ? `; filename*=UTF-8''${encoded}` : '';
  return `${disposition}; filename="${fallback}"${encodedPart}`;
}
