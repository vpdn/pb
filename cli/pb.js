#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

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
            reject(new Error(error.error || `Upload failed: ${res.statusCode}`));
          } catch (e) {
            reject(new Error(`Upload failed: ${res.statusCode}`));
          }
        }
      });
    });

    req.on('error', reject);
    req.write(formData);
    req.end();
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
      
      result.files.forEach((file, index) => {
        const uploadDate = new Date(file.uploadedAt).toLocaleString();
        const sizeKB = Math.round(file.size / 1024 * 100) / 100;
        
        console.log(`${index + 1}. ${file.originalName}`);
        console.log(`   URL: ${file.url}`);
        console.log(`   Size: ${sizeKB} KB (${file.size} bytes)`);
        console.log(`   Type: ${file.contentType || 'unknown'}`);
        console.log(`   Uploaded: ${uploadDate}`);
        console.log(`   File ID: ${file.fileId}`);
        console.log('');
      });
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