import { vi } from 'vitest';

export function createMockD1Database() {
  const mockResults = new Map<string, any>();
  
  const mockStmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(async () => mockResults.get('first')),
    run: vi.fn(async () => ({ success: true })),
    all: vi.fn(async () => mockResults.get('all') || [])
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

export function createMockFormData(files: { name: string; content: string | ArrayBuffer; type?: string }[]) {
  const formData = new FormData();
  
  files.forEach(({ name, content, type = 'application/octet-stream' }) => {
    const blob = new Blob([content], { type });
    const file = new File([blob], name, { type });
    formData.append('file', file);
  });

  return formData;
}

export function createMockEnv() {
  return {
    DB: createMockD1Database(),
    R2_BUCKET: createMockR2Bucket(),
    JWT_SECRET: 'test-secret'
  };
}

export function createMockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn()
  };
}