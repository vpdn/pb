#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { Table } = require('console-table-printer');

const DEFAULT_HOST = 'https://pb.nxh.ch';

function getContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    // Text files
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    // Web files
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    // Documents
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Archives
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.rar': 'application/vnd.rar',
    // Audio/Video
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    // Fonts
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function createProgressBar(current, total, width = 30) {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percentage}% ${formatBytes(current)}/${formatBytes(total)}`;
}

function printUsage() {
  console.log(`
Usage: pb <file> [options]
       pb --delete <url> [options]
       pb --list [options]

Options:
  -key <api_key>         API key for authentication (or set PB_API_KEY env var)
  -h, --host <host>      Server host (default: ${DEFAULT_HOST})
  --delete               Delete a file by URL
  --list                 List all files uploaded with your API key
  --help                 Show this help message

Examples:
  pb ./image.png
  pb ./document.pdf -key PB_API_KEY
  PB_API_KEY=PB_API_KEY pb ./file.txt
  pb --delete https://pb.nxh.ch/f/abc123 -key PB_API_KEY
  pb --list -key PB_API_KEY
`);
}

function parseArgs(args) {
  const options = {
    file: null,
    apiKey: process.env.PB_API_KEY,
    host: DEFAULT_HOST,
    delete: false,
    deleteUrl: null,
    list: false
  };

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (arg === '-key') {
      options.apiKey = args[++i];
    } else if (arg === '-h' || arg === '--host') {
      options.host = args[++i];
    } else if (arg === '--delete') {
      options.delete = true;
      options.deleteUrl = args[++i];
    } else if (arg === '--list') {
      options.list = true;
    } else if (!options.file && !options.delete && !options.list) {
      options.file = arg;
    }
  }

  return options;
}

async function uploadFile(filePath, apiKey, host) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  
  // Detect content type based on file extension
  const contentType = getContentType(fileName);
  
  // Create form data manually
  const boundary = '----FormBoundary' + Math.random().toString(36).substr(2);
  const formData = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`),
    Buffer.from(`Content-Type: ${contentType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const url = new URL('/upload', host);
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formData.length
      }
    };

    const protocol = url.protocol === 'https:' ? https : require('http');
    
    // Show file size only for larger files
    const showProgress = formData.length > 1024 * 1024; // Show progress for files > 1MB
    
    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        // Clear progress line if it was shown
        if (showProgress) {
          process.stdout.write('\x1b[2K\r');
        }
        
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (e) {
            reject(new Error('Invalid response from server'));
          }
        } else {
          try {
            const error = JSON.parse(data);
            reject(new Error(error.error || `Upload failed: ${res.statusCode}`));
          } catch (e) {
            reject(new Error(`Upload failed: ${res.statusCode}`));
          }
        }
      });
    });

    req.on('error', reject);
    
    if (showProgress) {
      // Write data in chunks to show progress
      const chunkSize = 65536; // 64KB chunks
      let offset = 0;
      let uploadedBytes = 0;
      const totalBytes = formData.length;
      
      // Show initial progress
      process.stdout.write(`Uploading: ${createProgressBar(0, totalBytes)}\r`);
      
      function writeNextChunk() {
        if (offset >= formData.length) {
          req.end();
          return;
        }
        
        const chunk = formData.slice(offset, Math.min(offset + chunkSize, formData.length));
        const canContinue = req.write(chunk);
        
        offset += chunk.length;
        uploadedBytes = offset;
        
        // Update progress bar
        process.stdout.write(`Uploading: ${createProgressBar(uploadedBytes, totalBytes)}\r`);
        
        if (canContinue) {
          setImmediate(writeNextChunk);
        } else {
          req.once('drain', writeNextChunk);
        }
      }
      
      writeNextChunk();
    } else {
      // For small files, just write at once
      req.write(formData);
      req.end();
    }
  });
}

async function deleteFile(url, apiKey) {
  try {
    // Parse the URL to extract the file ID
    const urlObj = new URL(url);
    if (!urlObj.pathname.startsWith('/f/')) {
      throw new Error('Invalid file URL format. Expected format: https://domain.com/f/fileId');
    }
    
    const fileId = urlObj.pathname.split('/f/')[1];
    if (!fileId) {
      throw new Error('Could not extract file ID from URL');
    }

    const deleteUrl = new URL(`/f/${fileId}`, url);
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: deleteUrl.hostname,
        port: deleteUrl.port || (deleteUrl.protocol === 'https:' ? 443 : 80),
        path: deleteUrl.pathname,
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      };

      const protocol = deleteUrl.protocol === 'https:' ? https : require('http');
      
      const req = protocol.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const result = JSON.parse(data);
              resolve(result);
            } catch (e) {
              reject(new Error('Invalid response from server'));
            }
          } else {
            try {
              const error = JSON.parse(data);
              reject(new Error(error.error || `Delete failed: ${res.statusCode}`));
            } catch (e) {
              reject(new Error(`Delete failed: ${res.statusCode}`));
            }
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }
}

async function listFiles(apiKey, host) {
  const url = new URL('/list', host);
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    };

    const protocol = url.protocol === 'https:' ? https : require('http');
    
    const req = protocol.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (e) {
            reject(new Error('Invalid response from server'));
          }
        } else {
          try {
            const error = JSON.parse(data);
            reject(new Error(error.error || `List failed: ${res.statusCode}`));
          } catch (e) {
            reject(new Error(`List failed: ${res.statusCode}`));
          }
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.list) {
    if (!options.apiKey) {
      console.error('Error: No API key provided. Use -key option or set PB_API_KEY environment variable.');
      process.exit(1);
    }

    try {
      console.log('Fetching file list...');
      const result = await listFiles(options.apiKey, options.host);
      
      if (result.files.length === 0) {
        console.log('\\nNo files found.');
        return;
      }

      console.log(`\\nFound ${result.files.length} file(s):\\n`);
      
      // Create table with console-table-printer
      const table = new Table({
        columns: [
          { name: '#', alignment: 'right' },
          { name: 'File Name', alignment: 'left' },
          { name: 'URL', alignment: 'left' },
          { name: 'Size', alignment: 'right' },
          { name: 'Type', alignment: 'left' },
          { name: 'Uploaded', alignment: 'right' }
        ]
      });
      
      result.files.forEach((file, index) => {
        const date = new Date(file.uploadedAt);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const uploadDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        
        // Format size with exactly 3 digits
        let sizeStr;
        const bytes = file.size;
        const kb = bytes / 1024;
        const mb = bytes / (1024 * 1024);
        const gb = bytes / (1024 * 1024 * 1024);
        
        if (kb < 1) {
          // Show small bytes as KB with 2 decimals
          sizeStr = `${kb.toFixed(2)} KB`;
        } else if (kb < 10) {
          sizeStr = `${kb.toFixed(2)} KB`;
        } else if (kb < 100) {
          sizeStr = `${kb.toFixed(1)} KB`;
        } else if (kb < 1000) {
          sizeStr = `${Math.round(kb)} KB`;
        } else if (mb < 10) {
          sizeStr = `${mb.toFixed(2)} MB`;
        } else if (mb < 100) {
          sizeStr = `${mb.toFixed(1)} MB`;
        } else if (mb < 1000) {
          sizeStr = `${Math.round(mb)} MB`;
        } else if (gb < 10) {
          sizeStr = `${gb.toFixed(2)} GB`;
        } else if (gb < 100) {
          sizeStr = `${gb.toFixed(1)} GB`;
        } else {
          sizeStr = `${Math.round(gb)} GB`;
        }
        
        table.addRow({
          '#': index + 1,
          'File Name': file.originalName,
          'URL': file.url,
          'Size': sizeStr,
          'Type': file.contentType || 'unknown',
          'Uploaded': uploadDate
        });
      });
      
      table.printTable();
    } catch (error) {
      console.error(`\\nError: ${error.message}`);
      process.exit(1);
    }
  } else if (options.delete) {
    if (!options.deleteUrl) {
      console.error('Error: No URL specified for deletion');
      printUsage();
      process.exit(1);
    }

    if (!options.apiKey) {
      console.error('Error: No API key provided. Use -key option or set PB_API_KEY environment variable.');
      process.exit(1);
    }

    try {
      console.log(`Deleting ${options.deleteUrl}...`);
      const result = await deleteFile(options.deleteUrl, options.apiKey);
      console.log(`\\nSuccess! File deleted.`);
      console.log(`File ID: ${result.fileId}`);
    } catch (error) {
      console.error(`\\nError: ${error.message}`);
      process.exit(1);
    }
  } else {
    if (!options.file) {
      console.error('Error: No file specified');
      printUsage();
      process.exit(1);
    }

    if (!options.apiKey) {
      console.error('Error: No API key provided. Use -key option or set PB_API_KEY environment variable.');
      process.exit(1);
    }

    try {
      console.log(`Uploading ${options.file}...`);
      const result = await uploadFile(options.file, options.apiKey, options.host);
      console.log(`\\nSuccess! File uploaded.`);
      console.log(`URL: ${result.url}`);
      console.log(`File ID: ${result.fileId}`);
      console.log(`Size: ${result.size} bytes`);
    } catch (error) {
      console.error(`\\nError: ${error.message}`);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main();
}