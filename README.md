# pb - Simple File Sharing Service

[![npm version](https://img.shields.io/npm/v/@vpdn/pb-sharelink.svg)](https://www.npmjs.com/package/@vpdn/pb-sharelink)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, serverless file upload and sharing service built on Cloudflare Workers. Upload files securely and share them with permanent URLs.

![pb upload demo](./pb_upload.svg)

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

Want to run your own pb instance? 

### Prerequisites

- [Node.js](https://nodejs.org/) version 16 or higher
- [Cloudflare account](https://cloudflare.com) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) - Install with: `npm install -g wrangler`

### Installation

#### Automated Setup (Recommended)

If you're using an AI assistant (like Claude, ChatGPT, or Cursor), you can have it automatically set up pb for you:

**Just point your AI assistant to this file: [INSTALL.md](./INSTALL.md)**

The installation guide contains step-by-step commands that AI assistants can execute on your behalf, making the setup process completely hands-free.

#### Manual Setup

If you prefer to set it up yourself:

1. **Clone and setup**
   ```bash
   git clone https://github.com/vpdn/pb.git
   cd pb
   npm install
   ```

2. **Login to Cloudflare**
   ```bash
   npx wrangler login
   ```

3. **Create KV namespace**
   ```bash
   npx wrangler kv namespace create "FILES"
   ```
   
   Copy the output and update `wrangler.toml` with your KV namespace ID.

4. **Deploy to Cloudflare**
   ```bash
   npm run deploy
   ```

That's it! Your pb service is now running on `https://pb.YOUR_SUBDOMAIN.workers.dev`

## Installation

### Install the CLI

```bash
npm install -g @vpdn/pb-sharelink
```

The CLI is now available as `pb` command after installation.

## Using pb

### API Key Setup

Access to pb is controlled through API keys. Each key can upload, list, and delete its own files.

1. **Generate an API key**
   ```bash
   node scripts/generate-api-key.js "My API Key"
   ```
   This creates a key like `pb_1234567890abcdef`

2. **Deploy the key to Cloudflare**
   ```bash
   npm run deploy
   ```
   This publishes your API key to the Worker's KV store

3. **Configure your shell** (Recommended)
   
   Add to your shell configuration file (~/.bashrc, ~/.bash_profile, or ~/.zshrc):
   ```bash
   export PB_API_KEY="pb_1234567890abcdef"
   ```
   
   Then reload your shell:
   ```bash
   source ~/.bashrc  # or source ~/.zshrc
   ```

### Upload files

Once you've installed the CLI and configured PB_API_KEY:

```bash
# Upload any file
pb myfile.pdf
# Returns: https://pb.YOUR_SUBDOMAIN.workers.dev/f/abc123def456

# Upload from pipe
echo "Hello world" | pb

# Upload with custom name
cat data.json | pb -n "backup.json"
```

**Alternative methods:**

```bash
# If you haven't set PB_API_KEY
pb myfile.pdf -key pb_1234567890abcdef

# Use curl directly
curl -X POST \
  -H "Authorization: Bearer pb_1234567890abcdef" \
  -F "file=@./myfile.pdf" \
  https://pb.YOUR_SUBDOMAIN.workers.dev/upload
```

### Common Operations

```bash
# Upload files (with PB_API_KEY configured)
pb screenshot.png
pb document.pdf
cat config.json | pb

# List all your files
pb --list

# List files in JSON format
pb --list --json

# Delete a file
pb --delete https://pb.YOUR_SUBDOMAIN.workers.dev/f/abc123def456

# Upload with JSON output
pb myfile.pdf --json

# Upload with expiration (file expires in 24 hours)
pb temp.txt --expiresAfter 24h

# Upload with expiration (file expires in 7 days)
pb document.pdf --expiresAfter 7d
```

### File Expiration

Set automatic file expiration with the `--expiresAfter` flag:

```bash
# Expire in minutes
pb temp.txt --expiresAfter 30m

# Expire in hours  
pb cache.json --expiresAfter 2h

# Expire in days
pb backup.zip --expiresAfter 7d

# Expire in weeks
pb archive.tar --expiresAfter 4w
```

**Features:**
- Files are automatically deleted after expiration
- Expired files return 410 (Gone) status
- Cleanup runs every 5 minutes via Cloudflare Cron Triggers
- List command shows remaining time until expiration

### JSON Output

All commands support `--json` flag for programmatic usage:

```bash
# Upload with JSON output
pb file.txt --json
# Output: {"url":"https://pb.example.com/f/abc123","fileId":"abc123","size":1234}

# List files as JSON
pb --list --json
# Output: {"files":[{"fileId":"abc123","originalName":"file.txt","size":1234,"contentType":"text/plain","uploadedAt":"2024-01-01T00:00:00Z","url":"https://pb.example.com/f/abc123"}]}

# Delete with JSON output
pb --delete https://pb.example.com/f/abc123 --json
# Output: {"message":"File deleted successfully","fileId":"abc123"}

# Errors are also returned as JSON
pb nonexistent.txt --json
# Output: {"error":"File not found: nonexistent.txt"}
```

## API Reference

See [API.md](./API.md) for detailed API documentation.

## License

MIT - Feel free to use this for your own file sharing needs!