import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock the CLI module by importing it directly
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn()
}));

// Mock https module
const mockRequest = vi.fn();
vi.mock('https', () => ({
  request: mockRequest
}));

// Mock require for dynamic http import
const mockHttpRequest = vi.fn();
vi.doMock('http', () => ({
  request: mockHttpRequest
}));

describe('CLI Tests', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = { ...process.env };
    vi.clearAllMocks();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
    mockProcessExit.mockClear();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  describe('Argument Parsing', () => {
    it('should parse upload arguments correctly', async () => {
      // Import CLI module to test parseArgs function
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', 'test.txt', '-key', 'pb_test123', '-h', 'https://custom.com'];
      const options = parseArgs(args);

      expect(options).toEqual({
        file: 'test.txt',
        apiKey: 'pb_test123',
        host: 'https://custom.com',
        delete: false,
        deleteUrl: null,
        list: false,
        json: false,
        expiresAfter: null,
        recursive: false
      });
    });

    it('should parse delete arguments correctly', async () => {
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', '--delete', 'https://example.com/f/abc123', '-key', 'pb_test123'];
      const options = parseArgs(args);

      expect(options).toEqual({
        file: null,
        apiKey: 'pb_test123',
        host: 'https://pb.nxh.ch',
        delete: true,
        deleteUrl: 'https://example.com/f/abc123',
        list: false,
        json: false,
        expiresAfter: null,
        recursive: false
      });
    });

    it('should use environment variable for API key', async () => {
      process.env.PB_API_KEY = 'pb_env_key';
      
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', 'test.txt'];
      const options = parseArgs(args);

      expect(options.apiKey).toBe('pb_env_key');
    });

    it('should override environment variable with command line flag', async () => {
      process.env.PB_API_KEY = 'pb_env_key';
      
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', 'test.txt', '-k', 'pb_cli_key'];
      const options = parseArgs(args);

      expect(options.apiKey).toBe('pb_cli_key');
    });

    it('should show help and exit', async () => {
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', '--help'];
      
      expect(() => parseArgs(args)).toThrow(); // Should exit
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it('should parse list arguments correctly', async () => {
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', '--list', '-key', 'pb_test123'];
      const options = parseArgs(args);

      expect(options).toEqual({
        file: null,
        apiKey: 'pb_test123',
        host: 'https://pb.nxh.ch',
        delete: false,
        deleteUrl: null,
        list: true,
        json: false,
        expiresAfter: null,
        recursive: false
      });
    });

    it('should enable recursive uploads when flag is provided', async () => {
      const { parseArgs } = await import('../cli/pb.js');

      const args = ['node', 'pb.js', 'folder', '--recursive', '-key', 'pb_test123'];
      const options = parseArgs(args);

      expect(options.recursive).toBe(true);

      const shortArgs = ['node', 'pb.js', 'folder', '-R', '-key', 'pb_test123'];
      const shortOptions = parseArgs(shortArgs);

      expect(shortOptions.recursive).toBe(true);
    });
  });

  describe('File Operations', () => {
    function setupDirectoryFsMocks() {
      const rootPath = path.join('my-folder');
      const file1 = path.join(rootPath, 'file1.txt');
      const subDir = path.join(rootPath, 'sub');
      const file2 = path.join(subDir, 'file2.txt');

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation((targetPath: any) => {
        switch (targetPath) {
          case rootPath:
            return { isFile: () => false, isDirectory: () => true } as any;
          case file1:
            return { isFile: () => true, isDirectory: () => false, size: 5 } as any;
          case subDir:
            return { isFile: () => false, isDirectory: () => true } as any;
          case file2:
            return { isFile: () => true, isDirectory: () => false, size: 6 } as any;
          default:
            throw new Error(`Unexpected statSync call: ${targetPath}`);
        }
      });

      vi.mocked(fs.readdirSync).mockImplementation((dir: any) => {
        if (dir === rootPath) {
          return [
            { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
            { name: 'sub', isDirectory: () => true, isFile: () => false }
          ] as any;
        }
        if (dir === subDir) {
          return [
            { name: 'file2.txt', isDirectory: () => false, isFile: () => true }
          ] as any;
        }
        throw new Error(`Unexpected readdirSync call: ${dir}`);
      });

      vi.mocked(fs.readFileSync).mockImplementation((targetPath: any) => {
        if (targetPath === file1) {
          return Buffer.from('file1');
        }
        if (targetPath === file2) {
          return Buffer.from('file-2');
        }
        throw new Error(`Unexpected readFileSync call: ${targetPath}`);
      });

      return { rootPath, file1, subDir, file2 };
    }

    it('should validate file existence before upload', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      const { uploadFile } = await import('../cli/pb.js');
      
      await expect(uploadFile('nonexistent.txt', 'pb_test123', 'https://example.com'))
        .rejects.toThrow('File not found: nonexistent.txt');
    });

    it('should reject unsupported file types', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false, isDirectory: () => false } as any);
      
      const { uploadFile } = await import('../cli/pb.js');
      
      await expect(uploadFile('directory', 'pb_test123', 'https://example.com'))
        .rejects.toThrow('Unsupported file type: directory');
    });

    it('should detect content type based on file extension', async () => {
      const { getContentType } = await import('../cli/pb.js');
      
      expect(getContentType('document.pdf')).toBe('application/pdf');
      expect(getContentType('image.png')).toBe('image/png');
      expect(getContentType('video.mp4')).toBe('video/mp4');
      expect(getContentType('unknown.xyz')).toBe('application/octet-stream');
    });

    it('should handle successful upload', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, isDirectory: () => false } as any);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('test content'));

      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"url":"https://example.com/f/abc123","fileId":"abc123","size":12}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { uploadFile } = await import('../cli/pb.js');
      
      const result = await uploadFile('test.txt', 'pb_test123', 'https://example.com');
      
      expect(result).toEqual({
        url: 'https://example.com/f/abc123',
        fileId: 'abc123',
        size: 12
      });
    });

    it('should skip subdirectories when recursive flag is not provided', async () => {
      const { rootPath } = setupDirectoryFsMocks();

      const capturedChunks: Buffer[] = [];

      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"url":"https://example.com/f/folder","fileId":"folder","size":11,"isDirectory":true}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        write: vi.fn((chunk: Buffer) => {
          capturedChunks.push(chunk);
          return true;
        }),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { uploadFile } = await import('../cli/pb.js');

      await uploadFile(rootPath, 'pb_test123', 'https://example.com');

      const payload = Buffer.concat(capturedChunks).toString('utf-8');
      expect(payload).toContain('filename="file1.txt"');
      expect(payload).not.toContain('filename="sub/file2.txt"');
      expect(payload).toContain('Content-Disposition: form-data; name="directory_upload"');
      expect(mockReq.end).toHaveBeenCalled();
    });

    it('should upload directory contents recursively when enabled', async () => {
      const { rootPath } = setupDirectoryFsMocks();

      const capturedChunks: Buffer[] = [];

      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"url":"https://example.com/f/folder","fileId":"folder","size":11,"isDirectory":true}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        write: vi.fn((chunk: Buffer) => {
          capturedChunks.push(chunk);
          return true;
        }),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { uploadFile } = await import('../cli/pb.js');

      await uploadFile(rootPath, 'pb_test123', 'https://example.com', null, true);

      const payload = Buffer.concat(capturedChunks).toString('utf-8');
      expect(payload).toContain('filename="file1.txt"');
      expect(payload).toContain('filename="sub/file2.txt"');
      expect(payload).toContain('Content-Disposition: form-data; name="directory_upload"');
      expect(mockReq.end).toHaveBeenCalled();
    });

    it('should handle upload errors', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, isDirectory: () => false } as any);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('test content'));

      const mockResponse = {
        statusCode: 400,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"error":"No file provided"}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { uploadFile } = await import('../cli/pb.js');
      
      await expect(uploadFile('test.txt', 'pb_test123', 'https://example.com'))
        .rejects.toThrow('No file provided');
    });
  });

  describe('List Operations', () => {
    it('should handle successful list request', async () => {
      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"files":[{"fileId":"abc123","originalName":"test.txt","size":12,"contentType":"text/plain","uploadedAt":"2023-12-01T10:30:00.000Z","url":"https://pb.nxh.ch/f/abc123"}]}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        expect(options.path).toBe('/list');
        expect(options.method).toBe('GET');
        expect(options.headers.Authorization).toBe('Bearer pb_test123');
        callback(mockResponse);
        return mockReq;
      });

      const { listFiles } = await import('../cli/pb.js');
      
      const result = await listFiles('pb_test123', 'https://example.com');
      
      expect(result).toEqual({
        files: [{
          fileId: 'abc123',
          originalName: 'test.txt',
          size: 12,
          contentType: 'text/plain',
          uploadedAt: '2023-12-01T10:30:00.000Z',
          url: 'https://pb.nxh.ch/f/abc123'
        }]
      });
    });

    it('should handle list errors', async () => {
      const mockResponse = {
        statusCode: 401,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"error":"Invalid API key"}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { listFiles } = await import('../cli/pb.js');
      
      await expect(listFiles('pb_invalid', 'https://example.com'))
        .rejects.toThrow('Invalid API key');
    });
  });

  describe('Delete Operations', () => {
    it('should parse file ID from URL correctly', async () => {
      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"message":"File deleted successfully","fileId":"abc123"}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        expect(options.path).toBe('/f/abc123');
        expect(options.method).toBe('DELETE');
        expect(options.headers.Authorization).toBe('Bearer pb_test123');
        callback(mockResponse);
        return mockReq;
      });

      const { deleteFile } = await import('../cli/pb.js');
      
      const result = await deleteFile('https://example.com/f/abc123', 'pb_test123');
      
      expect(result).toEqual({
        message: 'File deleted successfully',
        fileId: 'abc123'
      });
    });

    it('should handle invalid URL format', async () => {
      const { deleteFile } = await import('../cli/pb.js');
      
      await expect(deleteFile('https://example.com/invalid/url', 'pb_test123'))
        .rejects.toThrow('Invalid file URL format');
    });

    it('should handle delete errors', async () => {
      const mockResponse = {
        statusCode: 404,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"error":"File not found or access denied"}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { deleteFile } = await import('../cli/pb.js');
      
      await expect(deleteFile('https://example.com/f/abc123', 'pb_test123'))
        .rejects.toThrow('File not found or access denied');
    });
  });

  describe('Main Function', () => {
    it('should require file for upload', async () => {
      process.argv = ['node', 'pb.js'];
      
      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleError).toHaveBeenCalledWith('Error: No file specified');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should require API key', async () => {
      process.argv = ['node', 'pb.js', 'test.txt'];
      delete process.env.PB_API_KEY;
      
      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: No API key provided. Use -key option or set PB_API_KEY environment variable.'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should require URL for delete', async () => {
      process.argv = ['node', 'pb.js', '--delete'];
      process.env.PB_API_KEY = 'pb_test123';
      
      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleError).toHaveBeenCalledWith('Error: No URL specified for deletion');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle successful upload flow', async () => {
      process.argv = ['node', 'pb.js', 'test.txt'];
      process.env.PB_API_KEY = 'pb_test123';
      
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true, isDirectory: () => false } as any);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('test content'));

      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"url":"https://example.com/f/abc123","fileId":"abc123","size":12}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleLog).toHaveBeenCalledWith('Uploading file test.txt...');
      expect(mockConsoleLog).toHaveBeenCalledWith('\\nSuccess! File uploaded.');
      expect(mockConsoleLog).toHaveBeenCalledWith('URL: https://example.com/f/abc123');
      expect(mockConsoleLog).toHaveBeenCalledWith('File ID: abc123');
      expect(mockConsoleLog).toHaveBeenCalledWith('Size: 12 bytes');
    });

    it('should handle successful delete flow', async () => {
      process.argv = ['node', 'pb.js', '--delete', 'https://example.com/f/abc123'];
      process.env.PB_API_KEY = 'pb_test123';
      
      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"message":"File deleted successfully","fileId":"abc123"}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleLog).toHaveBeenCalledWith('Deleting https://example.com/f/abc123...');
      expect(mockConsoleLog).toHaveBeenCalledWith('\\nSuccess! File deleted.');
      expect(mockConsoleLog).toHaveBeenCalledWith('File ID: abc123');
    });

    it('should handle upload errors gracefully', async () => {
      process.argv = ['node', 'pb.js', 'test.txt'];
      process.env.PB_API_KEY = 'pb_test123';
      
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleError).toHaveBeenCalledWith('\\nError: File not found: test.txt');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle delete errors gracefully', async () => {
      process.argv = ['node', 'pb.js', '--delete', 'https://example.com/f/abc123'];
      process.env.PB_API_KEY = 'pb_test123';
      
      const mockResponse = {
        statusCode: 404,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"error":"File not found"}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleError).toHaveBeenCalledWith('\\nError: File not found');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should require API key for list', async () => {
      process.argv = ['node', 'pb.js', '--list'];
      delete process.env.PB_API_KEY;
      
      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error: No API key provided. Use -key option or set PB_API_KEY environment variable.'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle successful list flow', async () => {
      process.argv = ['node', 'pb.js', '--list'];
      process.env.PB_API_KEY = 'pb_test123';
      
      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"files":[{"fileId":"abc123","originalName":"test.txt","size":12,"contentType":"text/plain","uploadedAt":"2023-12-01T10:30:00.000Z","url":"https://pb.nxh.ch/f/abc123"}]}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { main } = await import('../cli/pb.js');
      
      await main();

      expect(mockConsoleLog).toHaveBeenCalledWith('Fetching file list...');
      expect(mockConsoleLog).toHaveBeenCalledWith('\\nFound 1 file(s):\\n');
    });

    it('should handle empty list gracefully', async () => {
      process.argv = ['node', 'pb.js', '--list'];
      process.env.PB_API_KEY = 'pb_test123';
      
      const mockResponse = {
        statusCode: 200,
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('{"files":[]}');
          } else if (event === 'end') {
            callback();
          }
        })
      };

      const mockReq = {
        on: vi.fn(),
        end: vi.fn()
      };

      mockRequest.mockImplementation((options, callback) => {
        callback(mockResponse);
        return mockReq;
      });

      const { main } = await import('../cli/pb.js');
      
      await main();
      
      expect(mockConsoleLog).toHaveBeenCalledWith('Fetching file list...');
      expect(mockConsoleLog).toHaveBeenCalledWith('\\nNo files found.');
    });
  });

  describe('Host Configuration', () => {
    it('should use default host when not specified', async () => {
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', 'test.txt'];
      const options = parseArgs(args);

      expect(options.host).toBe('https://pb.nxh.ch');
    });

    it('should use custom host when specified', async () => {
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', 'test.txt', '-h', 'https://custom.domain.com'];
      const options = parseArgs(args);

      expect(options.host).toBe('https://custom.domain.com');
    });

    it('should handle both short and long host flags', async () => {
      const { parseArgs } = await import('../cli/pb.js');
      
      const argsShort = ['node', 'pb.js', 'test.txt', '-h', 'https://short.com'];
      const argsLong = ['node', 'pb.js', 'test.txt', '--host', 'https://long.com'];
      
      const optionsShort = parseArgs(argsShort);
      const optionsLong = parseArgs(argsLong);

      expect(optionsShort.host).toBe('https://short.com');
      expect(optionsLong.host).toBe('https://long.com');
    });
  });
});
