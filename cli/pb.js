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

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function walkDirectory(root, current, files, recursive) {
  const entries = fs.readdirSync(current, { withFileTypes: true });

  entries.forEach((entry) => {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        walkDirectory(root, absolutePath, files, recursive);
      }
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, absolutePath);
      files.push({
        absolutePath,
        relativePath: toPosixPath(relativePath),
        size: fs.statSync(absolutePath).size,
        contentType: getContentType(absolutePath)
      });
    }
  });
}

function collectFilesForUpload(targetPath, recursive = false) {
  const stats = fs.statSync(targetPath);

  if (stats.isFile()) {
    const fileName = path.basename(targetPath);
    return {
      isDirectory: false,
      files: [{
        absolutePath: targetPath,
        relativePath: fileName,
        size: stats.size,
        contentType: getContentType(targetPath)
      }]
    };
  }

  if (stats.isDirectory()) {
    const files = [];
    walkDirectory(targetPath, targetPath, files, recursive);

    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return {
      isDirectory: true,
      files
    };
  }

  throw new Error(`Unsupported file type: ${targetPath}`);
}

function parseDuration(duration) {
  if (!duration) return null;

  const regex = /^(\d+)([mhdw])$/;
  const match = duration.toLowerCase().match(regex);

  if (!match) {
    throw new Error('Invalid duration format. Use formats like: 30m, 24h, 7d, 1w');
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  let milliseconds;
  switch (unit) {
    case 'm': milliseconds = value * 60 * 1000; break;
    case 'h': milliseconds = value * 60 * 60 * 1000; break;
    case 'd': milliseconds = value * 24 * 60 * 60 * 1000; break;
    case 'w': milliseconds = value * 7 * 24 * 60 * 60 * 1000; break;
  }

  return new Date(Date.now() + milliseconds).toISOString();
}

function parseThresholdTimestamp(duration) {
  if (!duration) return null;

  const regex = /^(\d+)([mhdw])$/;
  const match = duration.toLowerCase().match(regex);

  if (!match) {
    throw new Error('Invalid duration format. Use formats like: 30m, 24h, 7d, 1w');
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  let milliseconds;
  switch (unit) {
    case 'm': milliseconds = value * 60 * 1000; break;
    case 'h': milliseconds = value * 60 * 60 * 1000; break;
    case 'd': milliseconds = value * 24 * 60 * 60 * 1000; break;
    case 'w': milliseconds = value * 7 * 24 * 60 * 60 * 1000; break;
  }

  return new Date(Date.now() - milliseconds).toISOString();
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
       pb --delete --notAccessedSince <time> [options]
       pb --list [options]

Options:
  -key <api_key>         API key for authentication (or set PB_API_KEY env var)
  -h, --host <host>      Server host (default: ${DEFAULT_HOST})
  --delete               Delete a file by URL
  --list                 List all files uploaded with your API key
  --recursive, -R        Include subdirectories when uploading folders
  --json                 Output results in JSON format
  --expiresAfter <time>  Set file expiration (e.g., 30m, 24h, 7d, 1w)
  --notAccessedSince <time>  Delete files not accessed since duration (use with --delete)
  --help                 Show this help message

Examples:
  pb ./image.png
  pb ./document.pdf -key PB_API_KEY
  pb ./my-site/ --recursive -key PB_API_KEY
  PB_API_KEY=PB_API_KEY pb ./file.txt
  pb --delete https://pb.nxh.ch/f/abc123 -key PB_API_KEY
  pb --delete --notAccessedSince 30d -key PB_API_KEY
  pb --list -key PB_API_KEY
  pb --list --json -key PB_API_KEY
  pb ./file.txt --json -key PB_API_KEY
  pb ./temp.txt --expiresAfter 24h -key PB_API_KEY
`);
}

function parseArgs(args) {
  const options = {
    file: null,
    apiKey: process.env.PB_API_KEY,
    host: DEFAULT_HOST,
    delete: false,
    deleteUrl: null,
    list: false,
    json: false,
    expiresAfter: null,
    recursive: false,
    notAccessedSince: null
  };

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (arg === '-key' || arg === '-k') {
      options.apiKey = args[++i];
    } else if (arg === '-h' || arg === '--host') {
      options.host = args[++i];
    } else if (arg === '--delete') {
      options.delete = true;
      // Only consume next arg as URL if it's not another flag
      if (args[i + 1] && !args[i + 1].startsWith('--') && !args[i + 1].startsWith('-')) {
        options.deleteUrl = args[++i];
      }
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--recursive' || arg === '-R') {
      options.recursive = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--expiresAfter') {
      options.expiresAfter = args[++i];
    } else if (arg === '--notAccessedSince') {
      options.notAccessedSince = args[++i];
    } else if (!options.file && !options.delete && !options.list) {
      options.file = arg;
    }
  }

  return options;
}

async function uploadFile(filePath, apiKey, host, expiresAt = null, recursive = false) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const { isDirectory, files } = collectFilesForUpload(filePath, recursive);

  if (isDirectory && files.length === 0) {
    const message = recursive
      ? `Directory is empty: ${filePath}`
      : `Directory has no files at this level. Use --recursive to include subdirectories: ${filePath}`;
    throw new Error(message);
  }

  const boundary = '----FormBoundary' + Math.random().toString(36).substr(2);
  const formDataParts = [];

  files.forEach((file) => {
    const fileBuffer = fs.readFileSync(file.absolutePath);
    formDataParts.push(
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.relativePath}"\r\n`),
      Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n`)
    );
  });

  if (expiresAt) {
    formDataParts.push(
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="expires_at"\r\n\r\n`),
      Buffer.from(expiresAt),
      Buffer.from(`\r\n`)
    );
  }

  if (isDirectory) {
    formDataParts.push(
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="directory_upload"\r\n\r\n`),
      Buffer.from('true'),
      Buffer.from(`\r\n`)
    );
  }

  formDataParts.push(Buffer.from(`--${boundary}--\r\n`));
  const formData = Buffer.concat(formDataParts);

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
    const showProgress = formData.length > 1024 * 1024; // Show progress for payloads > 1MB
    
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

async function deleteOldFiles(apiKey, host, thresholdTimestamp, jsonOutput = false) {
  // Fetch all files
  const result = await listFiles(apiKey, host);

  if (result.files.length === 0) {
    if (!jsonOutput) {
      console.log('No files found.');
    }
    return { deletedCount: 0, files: [] };
  }

  // Filter files that haven't been accessed since threshold
  const filesToDelete = result.files.filter(file => {
    // If never accessed, include it
    if (!file.lastAccessedAt) {
      return true;
    }
    // Compare last accessed time with threshold
    return new Date(file.lastAccessedAt) < new Date(thresholdTimestamp);
  });

  if (filesToDelete.length === 0) {
    if (!jsonOutput) {
      console.log('No files found matching the criteria.');
    }
    return { deletedCount: 0, files: [] };
  }

  // Display files to be deleted (same format as --list)
  if (!jsonOutput) {
    console.log(`\nFound ${filesToDelete.length} file(s) not accessed since ${new Date(thresholdTimestamp).toLocaleString()}:\n`);

    const columns = [
      { name: '#', alignment: 'right' },
      { name: 'Group', alignment: 'left' },
      { name: 'Path', alignment: 'left' },
      { name: 'URL', alignment: 'left' },
      { name: 'Size', alignment: 'right' },
      { name: 'Last Accessed', alignment: 'right' }
    ];

    const table = new Table({ columns });

    filesToDelete.forEach((file, index) => {
      const lastAccessed = file.lastAccessedAt
        ? new Date(file.lastAccessedAt).toLocaleString()
        : 'Never';

      // Format size with exactly 3 digits
      let sizeStr;
      const bytes = file.size;
      const kb = bytes / 1024;
      const mb = bytes / (1024 * 1024);
      const gb = bytes / (1024 * 1024 * 1024);

      if (kb < 1) {
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

      const displayName = file.relativePath || file.originalName;
      table.addRow({
        '#': index + 1,
        'Group': file.groupId || file.fileId,
        'Path': displayName,
        'URL': file.url,
        'Size': sizeStr,
        'Last Accessed': lastAccessed
      });
    });

    table.printTable();
  }

  // Ask for confirmation
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve, reject) => {
    rl.question(`\nDelete ${filesToDelete.length} file(s)? (yes/no): `, async (answer) => {
      rl.close();

      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        if (!jsonOutput) {
          console.log('Deletion cancelled.');
        }
        resolve({ deletedCount: 0, files: [], cancelled: true });
        return;
      }

      // Delete files one by one
      let deletedCount = 0;
      const deletedFiles = [];

      for (const file of filesToDelete) {
        try {
          if (!jsonOutput) {
            process.stdout.write(`Deleting ${file.fileId}... `);
          }
          await deleteFile(file.url, apiKey);
          deletedCount++;
          deletedFiles.push({ fileId: file.fileId, url: file.url });
          if (!jsonOutput) {
            console.log('done');
          }
        } catch (error) {
          if (!jsonOutput) {
            console.log(`failed: ${error.message}`);
          }
        }
      }

      if (!jsonOutput) {
        console.log(`\nDeleted ${deletedCount} of ${filesToDelete.length} file(s).`);
      }

      resolve({ deletedCount, files: deletedFiles, total: filesToDelete.length });
    });
  });
}

async function main() {
  const options = parseArgs(process.argv);

  // Validate --notAccessedSince is only used with --delete
  if (options.notAccessedSince && !options.delete) {
    if (options.json) {
      console.log(JSON.stringify({ error: '--notAccessedSince must be used with --delete' }));
    } else {
      console.error('Error: --notAccessedSince must be used with --delete');
      printUsage();
    }
    process.exit(1);
  }

  if (options.list) {
    if (!options.apiKey) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No API key provided. Use -key option or set PB_API_KEY environment variable.' }));
      } else {
        console.error('Error: No API key provided. Use -key option or set PB_API_KEY environment variable.');
      }
      process.exit(1);
    }

    try {
      if (!options.json) {
        console.log('Fetching file list...');
      }
      const result = await listFiles(options.apiKey, options.host);
      
      if (options.json) {
        console.log(JSON.stringify(result));
        return;
      }
      
      if (result.files.length === 0) {
        console.log('\\nNo files found.');
        return;
      }

      console.log(`\\nFound ${result.files.length} file(s):\\n`);
      
      // Create table with console-table-printer
      const columns = [
        { name: '#', alignment: 'right' },
        { name: 'Group', alignment: 'left' },
        { name: 'Path', alignment: 'left' },
        { name: 'URL', alignment: 'left' },
        { name: 'Size', alignment: 'right' },
        { name: 'Type', alignment: 'left' },
        { name: 'Uploaded', alignment: 'right' }
      ];
      
      // Add expiration column if any file has expiration
      const hasExpiration = result.files.some(file => file.expiresAt);
      if (hasExpiration) {
        columns.push({ name: 'Expires', alignment: 'right' });
      }
      
      const table = new Table({ columns });
      
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
        
        const displayName = file.relativePath || file.originalName;
        const row = {
          '#': index + 1,
          'Group': file.groupId || file.fileId,
          'Path': displayName,
          'URL': file.url,
          'Size': sizeStr,
          'Type': file.contentType || 'unknown',
          'Uploaded': uploadDate
        };
        
        if (hasExpiration) {
          row['Expires'] = file.remainingTime || '-';
        }
        
        table.addRow(row);
      });
      
      table.printTable();
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }));
      } else {
        console.error(`\\nError: ${error.message}`);
      }
      process.exit(1);
    }
  } else if (options.delete) {
    if (!options.apiKey) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No API key provided. Use -key option or set PB_API_KEY environment variable.' }));
      } else {
        console.error('Error: No API key provided. Use -key option or set PB_API_KEY environment variable.');
      }
      process.exit(1);
    }

    // Handle --notAccessedSince with --delete
    if (options.notAccessedSince) {
      try {
        const thresholdTimestamp = parseThresholdTimestamp(options.notAccessedSince);
        const result = await deleteOldFiles(options.apiKey, options.host, thresholdTimestamp, options.json);

        if (options.json) {
          console.log(JSON.stringify(result));
        }
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }));
        } else {
          console.error(`\\nError: ${error.message}`);
        }
        process.exit(1);
      }
    } else {
      // Handle single file deletion by URL
      if (!options.deleteUrl) {
        if (options.json) {
          console.log(JSON.stringify({ error: 'No URL specified for deletion' }));
        } else {
          console.error('Error: No URL specified for deletion');
          printUsage();
        }
        process.exit(1);
      }

      try {
        if (!options.json) {
          console.log(`Deleting ${options.deleteUrl}...`);
        }
        const result = await deleteFile(options.deleteUrl, options.apiKey);
        if (options.json) {
          console.log(JSON.stringify(result));
        } else if (result.deletedCount) {
          console.log(`\\nSuccess! Folder deleted.`);
          console.log(`Folder ID: ${result.fileId}`);
          console.log(`Files removed: ${result.deletedCount}`);
        } else {
          console.log(`\\nSuccess! File deleted.`);
          console.log(`File ID: ${result.fileId}`);
        }
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message }));
        } else {
          console.error(`\\nError: ${error.message}`);
        }
        process.exit(1);
      }
    }
  } else {
    if (!options.file) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No file specified' }));
      } else {
        console.error('Error: No file specified');
        printUsage();
      }
      process.exit(1);
    }

    if (!options.apiKey) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No API key provided. Use -key option or set PB_API_KEY environment variable.' }));
      } else {
        console.error('Error: No API key provided. Use -key option or set PB_API_KEY environment variable.');
      }
      process.exit(1);
    }

    try {
      let expiresAt = null;
      if (options.expiresAfter) {
        try {
          expiresAt = parseDuration(options.expiresAfter);
        } catch (e) {
          if (options.json) {
            console.log(JSON.stringify({ error: e.message }));
          } else {
            console.error(`Error: ${e.message}`);
          }
          process.exit(1);
        }
      }
      
      if (!options.json) {
        try {
          const stats = fs.statSync(options.file);
          const type = stats.isDirectory() ? 'directory' : 'file';
          console.log(`Uploading ${type} ${options.file}...`);
        } catch {
          console.log(`Uploading ${options.file}...`);
        }
      }
      const result = await uploadFile(options.file, options.apiKey, options.host, expiresAt, options.recursive);
      if (options.json) {
        console.log(JSON.stringify(result));
      } else if (result.isDirectory) {
        console.log(`\\nSuccess! Folder uploaded.`);
        console.log(`Base URL: ${result.url}`);
        console.log(`Folder ID: ${result.fileId}`);
        const totalFiles = result.files ? result.files.length : 0;
        console.log(`Files: ${totalFiles}`);
        console.log(`Total Size: ${formatBytes(result.size)} (${result.size} bytes)`);
        if (totalFiles > 0) {
          const previewLimit = 5;
          const preview = result.files.slice(0, previewLimit);
          console.log(`Sample files:`);
          preview.forEach((file) => {
            console.log(`  - ${file.relativePath || file.originalName}`);
          });
          if (totalFiles > previewLimit) {
            console.log(`  ... (${totalFiles - previewLimit} more)`);
          }
        }
        if (result.expiresAt) {
          console.log(`Expires: ${new Date(result.expiresAt).toLocaleString()}`);
        }
      } else {
        console.log(`\\nSuccess! File uploaded.`);
        console.log(`URL: ${result.url}`);
        console.log(`File ID: ${result.fileId}`);
        console.log(`Size: ${result.size} bytes`);
        if (result.expiresAt) {
          console.log(`Expires: ${new Date(result.expiresAt).toLocaleString()}`);
        }
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }));
      } else {
        console.error(`\\nError: ${error.message}`);
      }
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main();
}
