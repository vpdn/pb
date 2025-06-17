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
  readFileSync: vi.fn()
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
      
      const args = ['node', 'pb.js', 'test.txt', '-k', 'pb_test123', '-h', 'https://custom.com'];
      const options = parseArgs(args);

      expect(options).toEqual({
        file: 'test.txt',
        apiKey: 'pb_test123',
        host: 'https://custom.com',
        delete: false,
        deleteUrl: null
      });
    });

    it('should parse delete arguments correctly', async () => {
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', '--delete', 'https://example.com/f/abc123', '-k', 'pb_test123'];
      const options = parseArgs(args);

      expect(options).toEqual({
        file: null,
        apiKey: 'pb_test123',
        host: 'https://pb.readingjourney.workers.dev',
        delete: true,
        deleteUrl: 'https://example.com/f/abc123'
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
  });

  describe('File Operations', () => {
    it('should validate file existence before upload', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      const { uploadFile } = await import('../cli/pb.js');
      
      await expect(uploadFile('nonexistent.txt', 'pb_test123', 'https://example.com'))
        .rejects.toThrow('File not found: nonexistent.txt');
    });

    it('should validate file is not a directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => false } as any);
      
      const { uploadFile } = await import('../cli/pb.js');
      
      await expect(uploadFile('directory', 'pb_test123', 'https://example.com'))
        .rejects.toThrow('Not a file: directory');
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
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
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

    it('should handle upload errors', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
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
        'Error: No API key provided. Use -k option or set PB_API_KEY environment variable.'
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
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as any);
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
      
      expect(mockConsoleLog).toHaveBeenCalledWith('Uploading test.txt...');
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
  });

  describe('Host Configuration', () => {
    it('should use default host when not specified', async () => {
      const { parseArgs } = await import('../cli/pb.js');
      
      const args = ['node', 'pb.js', 'test.txt'];
      const options = parseArgs(args);

      expect(options.host).toBe('https://pb.readingjourney.workers.dev');
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