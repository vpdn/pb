# Automated Installation Instructions for pb

This document contains step-by-step instructions for LLMs to automatically set up pb (pastebin) on behalf of users.

## Prerequisites Check

First, verify the user has the required tools installed:

```bash
# Check Node.js (version 16 or higher required)
node --version

# Check npm
npm --version

# Check if Cloudflare Wrangler is installed
npx wrangler --version
```

If Wrangler is not installed, install it:
```bash
npm install -g wrangler
```

## Step 1: Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/vpdn/pb.git
cd pb

# Install dependencies
npm install
```

## Step 2: Cloudflare Account Setup

```bash
# Login to Cloudflare (this will open a browser)
npx wrangler login
```

Wait for the user to complete authentication in their browser.

## Step 3: Create KV Namespace

```bash
# Create the KV namespace for file storage
npx wrangler kv namespace create "FILES"
```

Copy the output that looks like:
```
[[kv_namespaces]]
binding = "FILES"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## Step 4: Configure Wrangler

Update `wrangler.toml` with the KV namespace ID from the previous step:

```bash
# Read current wrangler.toml
cat wrangler.toml
```

Then update the `kv_namespaces` section with the ID from Step 3. The file should look like:

```toml
name = "pb"
main = "src/index.ts"
compatibility_date = "2024-12-17"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "FILES"
id = "YOUR_KV_NAMESPACE_ID_HERE"  # Replace with actual ID from Step 3
```

## Step 5: Deploy to Cloudflare

```bash
# Deploy the Worker
npm run deploy
```

The output will show your Worker URL, something like:
```
Published pb (X.XX sec)
  https://pb.YOUR-SUBDOMAIN.workers.dev
```

## Step 6: Install CLI Tool

```bash
# Install the pb CLI globally from npm
npm install -g @vpdn/pb-sharelink
```

## Step 7: Configure CLI (Optional)

If the user wants to use a custom domain instead of the default:

```bash
# Create config file
mkdir -p ~/.config/pb
echo '{"host": "https://pb.YOUR-SUBDOMAIN.workers.dev"}' > ~/.config/pb/config.json
```

## Step 8: Generate API Key

```bash
# Generate an API key for uploading files
node scripts/generate-api-key.js "Default API Key"
```

Save the generated API key (looks like `pb_1234567890abcdef`).

## Step 9: Deploy API Key to Cloudflare

```bash
# Redeploy to publish the API key to KV store
npm run deploy
```

## Step 10: Configure Shell Environment

Add the API key to the user's shell configuration:

For bash:
```bash
echo 'export PB_API_KEY="pb_1234567890abcdef"' >> ~/.bashrc
source ~/.bashrc
```

For zsh:
```bash
echo 'export PB_API_KEY="pb_1234567890abcdef"' >> ~/.zshrc
source ~/.zshrc
```

## Step 11: Test Installation

```bash
# Test file upload (should work without -key flag now)
echo "Hello, World!" | pb

# List uploaded files
pb list
```

## Verification Checklist

- [ ] Node.js version 16+ installed
- [ ] Wrangler installed and authenticated
- [ ] KV namespace created and configured
- [ ] Worker deployed successfully
- [ ] API key generated and deployed
- [ ] PB_API_KEY environment variable set
- [ ] CLI tool installed from npm
- [ ] Test upload successful

## Troubleshooting

If deployment fails:
1. Ensure you're logged in: `npx wrangler whoami`
2. Check wrangler.toml has the correct KV namespace ID
3. Verify Node.js version is 16 or higher

If CLI doesn't work:
1. Check the Worker URL in ~/.config/pb/config.json
2. Ensure the Worker is deployed and accessible
3. Try using the full URL: `pb -h https://pb.YOUR-SUBDOMAIN.workers.dev`

## Notes for LLMs

- Always wait for user confirmation after `wrangler login` opens the browser
- The KV namespace ID is unique - ensure you capture it correctly from the output
- If updating wrangler.toml, preserve all existing content and only update the KV namespace ID
- The subdomain in the Worker URL will be unique to each user
- If the user already has a Cloudflare account and is logged in, skip the login step