@echo off
REM Setup Cloudflare resources for Image Sharing Platform (Windows)
REM Run this script to automatically create all required R2 buckets and KV namespaces

setlocal enabledelayedexpansion

echo.
echo 🚀 Setting up Cloudflare Image Sharing resources...
echo.

REM Check if wrangler is installed
where wrangler >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ wrangler not found. Please install it first:
    echo    npm install -g wrangler
    exit /b 1
)

REM Login to Cloudflare
echo 🔐 Authenticating with Cloudflare...
call wrangler login

echo.
echo 📦 Creating R2 Buckets...

REM Create R2 Buckets
call wrangler r2 bucket create photremium-sharing 2>nul || echo ⚠️  photremium-sharing already exists
call wrangler r2 bucket create photremium-sharing-preview 2>nul || echo ⚠️  photremium-sharing-preview already exists
call wrangler r2 bucket create photremium-sharing-prod 2>nul || echo ⚠️  photremium-sharing-prod already exists
call wrangler r2 bucket create photremium-sharing-prod-preview 2>nul || echo ⚠️  photremium-sharing-prod-preview already exists

echo.
echo 🔑 Creating KV Namespaces...

call wrangler kv namespace create "sharing-sessions"
call wrangler kv namespace create "sharing-sessions-preview" --preview
call wrangler kv namespace create "sharing-files"
call wrangler kv namespace create "sharing-files-preview" --preview

echo.
echo ✅ Cloudflare resources created successfully!
echo.
echo 📋 Next steps:
echo 1. Update wrangler.toml with the KV namespace IDs (from the output above)
echo 2. Run: npm run build ^&^& npm run deploy:pages
echo 3. Visit your Cloudflare Pages site to test the Image Sharing feature
echo.
echo 🔍 Verify resources:
echo    wrangler r2 object list photremium-sharing
echo    wrangler kv namespace list
echo.
pause
