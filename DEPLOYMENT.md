# pb Deployment

Your pb service has been successfully deployed to Cloudflare Workers!

## Service Information

- **URL**: https://pb.readingjourney.workers.dev
- **Database**: pb-db (d480dfa4-d3c4-4c4a-8770-d32623352d7a)
- **Storage Bucket**: pb-files
- **API Key**: pb_qCmHJj3jA9UjvmyQggiVlBs7ADcstHX

## Usage

### CLI Upload
```bash
export PBWEB_API_KEY=pb_qCmHJj3jA9UjvmyQggiVlBs7ADcstHX
node cli/pb.js yourfile.txt
```

### curl Upload
```bash
curl -X POST \
  -H "Authorization: Bearer pb_qCmHJj3jA9UjvmyQggiVlBs7ADcstHX" \
  -F "file=@yourfile.txt" \
  https://pb.readingjourney.workers.dev/upload
```

### File Access
Files are accessible at: `https://pb.readingjourney.workers.dev/f/{fileId}`

## Management

### Add New API Key
```bash
node scripts/generate-api-key.js
npx wrangler d1 execute pb-db --remote --command="INSERT INTO api_keys (key, name) VALUES ('NEW_KEY', 'KEY_NAME')"
```

### View Database
```bash
npx wrangler d1 execute pb-db --remote --command="SELECT * FROM api_keys"
npx wrangler d1 execute pb-db --remote --command="SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT 10"
```

### Deployment Commands
```bash
# Deploy changes
npx wrangler deploy

# View logs
npx wrangler tail pb

# Local development
npm run dev
```

## Test Upload
```bash
# Test with included test file
export PBWEB_API_KEY=pb_qCmHJj3jA9UjvmyQggiVlBs7ADcstHX
node cli/pb.js test.txt
```