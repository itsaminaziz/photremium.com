# Image Sharing Platform - Deployment Guide

## Overview
The Image Sharing platform is a peer-to-peer image transfer system using:
- **Cloudflare Workers** (Functions) for backend API
- **R2 Storage** for image files (10GB free quota)
- **KV Storage** for session metadata
- **Cron Triggers** for automatic cleanup every 20 minutes

## Setup Instructions

### 1. Create Cloudflare Resources

```bash
# Authenticate with Cloudflare
wrangler login

# Create R2 Bucket
wrangler r2 bucket create photremium-sharing
wrangler r2 bucket create photremium-sharing-preview

# Create KV Namespaces
wrangler kv:namespace create "sharing-sessions"
wrangler kv:namespace create "sharing-files"
wrangler kv:namespace create "sharing-sessions" --preview
wrangler kv:namespace create "sharing-files" --preview
```

### 2. Update wrangler.toml with Resource IDs

After creating resources, update `wrangler.toml` with the actual IDs:

```toml
kv_namespaces = [
  { binding = "SESSIONS", id = "YOUR_SESSIONS_ID", preview_id = "YOUR_SESSIONS_PREVIEW_ID" },
  { binding = "FILES", id = "YOUR_FILES_ID", preview_id = "YOUR_FILES_PREVIEW_ID" }
]

[[r2_buckets]]
binding = "IMAGE_BUCKET"
bucket_name = "photremium-sharing"
preview_bucket_name = "photremium-sharing-preview"
```

### 3. Deploy to Cloudflare Pages

```bash
# Generate blogs sitemap (if needed)
node scripts/generate-blogs-sitemap.js

# Build the React app
npm run build

# Deploy to Cloudflare Pages with Workers
npm run deploy:pages
```

Or manually:
```bash
npx wrangler pages deploy build --project-name photremium
```

### 4. Enable Cron Triggers (Optional - for automated cleanup)

```bash
# Set environment to production for cron triggers
wrangler publish --env production
```

## API Endpoints

### Session Management

#### Create Session
```
POST /api/sharing/session?action=create
Body: { "ownerDevice": "web" }
Response: { "sessionId": "...", "expiresAt": ..., "qrData": "..." }
```

#### Get Session
```
GET /api/sharing/session?action=get&sessionId=...
Response: { "id": "...", "files": [], "expiresAt": ..., ... }
```

#### End Session
```
POST /api/sharing/session?action=end
Body: { "sessionId": "..." }
Response: { "success": true }
```

### File Operations

#### Upload Chunk
```
POST /api/sharing/files?sessionId=...&fileName=...&chunkIndex=0&totalChunks=10&fileSize=...
Body: (binary chunk data)
Response: { "success": true, "chunkIndex": 0, "uploadedBytes": ... }
```

#### Download File
```
GET /api/sharing/files?sessionId=...&fileName=...
Response: (binary file data)
```

#### Delete File
```
DELETE /api/sharing/files?sessionId=...&fileName=...
Response: { "success": true }
```

## Architecture

### Session Lifecycle
1. User opens "Image Sharing" feature
2. Create unique session → Generate QR code
3. Another device scans QR code → Joins same session
4. Files transferred with real-time progress
5. Session auto-expires after 1 hour or when owner ends it
6. Cron cleanup every 20 mins deletes expired sessions + orphaned files

### Storage Limits
- **Per Session**: 1GB max
- **File Chunks**: 5MB per chunk (resumable)
- **Session TTL**: 1 hour (auto-expire)
- **Free Quota**: 10GB R2 storage per month

### Progress Tracking
- Real-time byte-level progress (not fake/simulated)
- Chunk-based upload/download with streaming
- Resumable transfers on network failure
- Live sync updates via fetch API

## File Metadata Preservation
- Original filename retained
- File extension preserved
- Folder structure maintained in session
- EXIF/metadata preserved (in bytes)

## Security Considerations
- Sessions isolated by unique ID
- No authentication required (session-based)
- Automatic cleanup prevents data leaks
- Orphaned chunk detection (1.5hr cleanup)
- HTTPS enforced on Cloudflare Pages

## Monitoring

### View KV Data
```bash
wrangler kv:key list --namespace-id <ID>
```

### View R2 Bucket
```bash
wrangler r2 object list photremium-sharing
```

### Check Worker Logs
```bash
wrangler tail
```

## Troubleshooting

### R2 Upload Fails
- Check R2 bucket exists and binding is correct
- Verify wrangler.toml has correct bucket name and binding

### Sessions Not Expiring
- Check KV namespace binding
- Verify cron trigger is enabled (production env)
- Check Cloudflare dashboard for trigger logs

### File Download Broken
- Ensure all chunks are uploaded (check manifest status)
- Verify file names don't have special characters
- Check R2 chunks exist: `wrangler r2 object list photremium-sharing`

## Future Enhancements
- Pagination for file lists
- Compression on-the-fly
- Password-protected sessions
- Multi-device sync
- Batch operations
- Analytics dashboard
