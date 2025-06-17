# pb - Simple File Sharing Service

A lightweight, serverless file upload and sharing service built on Cloudflare Workers. Upload files securely and share them with permanent URLs.

## What is pb?

pb is a modern pastebin-like service for files. It provides:

- **Secure uploads** with API key authentication
- **Instant sharing** with permanent URLs
- **No file size limits** (within Cloudflare's limits)
- **Command-line interface** for easy integration
- **Serverless architecture** - no servers to maintain
- **Global CDN** distribution via Cloudflare

## How it works

1. **Upload**: Send files via CLI, curl, or API with your API key
2. **Store**: Files are stored securely in Cloudflare R2 storage
3. **Share**: Get a permanent URL that works forever
4. **Access**: Anyone with the URL can download the file

## Quick Start

Want to run your own pb instance? Follow these steps:

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare account](https://cloudflare.com) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed globally

### Installation

1. **Clone and setup**
   ```bash
   git clone <your-repo-url>
   cd pb
   npm install
   ```

2. **Create Cloudflare resources**
   ```bash
   # Create D1 database for metadata
   npx wrangler d1 create pb-db
   
   # Create R2 bucket for file storage
   npx wrangler r2 bucket create pb-files
   ```

3. **Configure the service**
   
   Update `wrangler.jsonc` with your database ID from step 2:
   ```json
   "d1_databases": [
     {
       "binding": "DB", 
       "database_name": "pb-db",
       "database_id": "YOUR_DATABASE_ID_HERE"
     }
   ]
   ```

4. **Initialize the database**
   ```bash
   npm run db:init
   ```

5. **Deploy to Cloudflare**
   ```bash
   npm run deploy
   ```

That's it! Your pb service is now running on `https://pb.YOUR_SUBDOMAIN.workers.dev`

## Using pb

### Create an API key

Generate an API key to authenticate uploads:

```bash
# Generate a secure API key  
node scripts/generate-api-key.js "My API Key"
```

This creates a key like `pb_1234567890abcdef` and adds it to your database.

### Upload files

**Option 1: Install the CLI globally**
```bash
npm link
pb ./myfile.pdf -key PB_API_KEY
```

**Option 2: Use npx (no installation needed)**
```bash
npx ./cli/pb.js ./myfile.pdf -key PB_API_KEY
```

**Option 3: Use environment variable**
```bash
export PB_API_KEY=PB_API_KEY
npx ./cli/pb.js ./myfile.pdf
```

**Option 4: Use curl directly**
```bash
curl -X POST \
  -H "Authorization: Bearer PB_API_KEY" \
  -F "file=@./myfile.pdf" \
  https://pb.YOUR_SUBDOMAIN.workers.dev/upload
```

### Examples

```bash
# Upload an image
pb screenshot.png -key pb_abc123

# Upload with custom filename
pb ./report.pdf -key pb_abc123

# Pipe content
echo "Hello world" | pb -key pb_abc123

# Upload to custom domain
pb file.txt -key pb_abc123 -h https://files.example.com

# List all your uploaded files
pb --list -key pb_abc123

# Delete a file by URL
pb --delete https://pb.nxh.ch/f/abc123def456 -key pb_abc123
```

## API Reference

### Upload endpoint
```http
POST /upload
Authorization: Bearer PB_API_KEY
Content-Type: multipart/form-data

{file: binary data}
```

Response:
```json
{
  "url": "https://pb.YOUR_SUBDOMAIN.workers.dev/f/abc123def456", 
  "fileId": "abc123def456",
  "size": 1024
}
```

### Download endpoint  
```http
GET /f/{fileId}
```

Returns the original file with proper content-type headers.

### Delete endpoint
```http
DELETE /f/{fileId}
Authorization: Bearer PB_API_KEY
```

Response:
```json
{
  "fileId": "abc123def456",
  "message": "File deleted successfully"
}
```

### List files endpoint
```http
GET /list
Authorization: Bearer PB_API_KEY
```

Response:
```json
{
  "files": [
    {
      "fileId": "abc123def456",
      "originalName": "document.pdf",
      "size": 1024,
      "contentType": "application/pdf",
      "uploadedAt": "2023-12-01T10:30:00.000Z",
      "url": "https://pb.YOUR_SUBDOMAIN.workers.dev/f/abc123def456"
    }
  ]
}

## Development

**Local development**
```bash
npm run dev
```

**Run tests**
```bash
npm test
```

**Type checking**
```bash
npm run cf-typegen
```

## Architecture

- **Workers**: Serverless functions handling uploads/downloads
- **R2**: Object storage for files (S3-compatible)
- **D1**: SQLite database for metadata and API keys
- **Global**: Deployed on Cloudflare's global network


## License

MIT - Feel free to use this for your own file sharing needs!