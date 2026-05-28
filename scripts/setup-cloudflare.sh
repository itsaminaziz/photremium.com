#!/bin/bash
# Setup Cloudflare resources for Image Sharing Platform
# Run this script to automatically create all required R2 buckets and KV namespaces

set -e

echo "🚀 Setting up Cloudflare Image Sharing resources..."
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler not found. Please install it first:"
    echo "   npm install -g wrangler"
    exit 1
fi

# Login to Cloudflare
echo "🔐 Authenticating with Cloudflare..."
wrangler login

echo ""
echo "📦 Creating R2 Buckets..."

# Create R2 Buckets
wrangler r2 bucket create photremium-sharing || echo "⚠️  photremium-sharing already exists"
wrangler r2 bucket create photremium-sharing-preview || echo "⚠️  photremium-sharing-preview already exists"
wrangler r2 bucket create photremium-sharing-prod || echo "⚠️  photremium-sharing-prod already exists"
wrangler r2 bucket create photremium-sharing-prod-preview || echo "⚠️  photremium-sharing-prod-preview already exists"

echo ""
echo "🔑 Creating KV Namespaces..."

# Create KV Namespaces for development
echo "Creating production KV namespaces..."
SESSIONS_ID=$(wrangler kv namespace create "sharing-sessions" --json | jq -r '.id // .namespace_id')
SESSIONS_PREVIEW=$(wrangler kv namespace create "sharing-sessions-preview" --preview --json | jq -r '.id // .namespace_id')
FILES_ID=$(wrangler kv namespace create "sharing-files" --json | jq -r '.id // .namespace_id')
FILES_PREVIEW=$(wrangler kv namespace create "sharing-files-preview" --preview --json | jq -r '.id // .namespace_id')

echo ""
echo "📝 Update your wrangler.toml with these IDs:"
echo ""
echo "kv_namespaces = ["
echo "  { binding = \"SESSIONS\", id = \"$SESSIONS_ID\", preview_id = \"$SESSIONS_PREVIEW\" },"
echo "  { binding = \"FILES\", id = \"$FILES_ID\", preview_id = \"$FILES_PREVIEW\" }"
echo "]"
echo ""

# Save to wrangler.toml (optional - user can do this manually)
cat > .env.cloudflare << EOF
SESSIONS_ID=$SESSIONS_ID
SESSIONS_PREVIEW=$SESSIONS_PREVIEW
FILES_ID=$FILES_ID
FILES_PREVIEW=$FILES_PREVIEW
EOF

echo "✅ Cloudflare resources created successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Update wrangler.toml with the KV namespace IDs above"
echo "2. Run: npm run build && npm run deploy:pages"
echo "3. Visit your Cloudflare Pages site to test the Image Sharing feature"
echo ""
echo "🔍 Verify resources:"
echo "   wrangler r2 object list photremium-sharing"
echo "   wrangler kv:key list --namespace-id $SESSIONS_ID"
echo ""
