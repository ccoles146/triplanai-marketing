#!/bin/bash

# Setup Telegram Webhook for triplanai-marketing
# Usage: ./scripts/setup-webhook.sh [production|local]

set -e

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment variables from .env file
if [ -f "$PROJECT_DIR/.env" ]; then
  # Export WEBHOOK_URL from .env
  export $(grep "^WEBHOOK_URL=" "$PROJECT_DIR/.env" | xargs)
else
  echo "⚠️  Warning: .env file not found at $PROJECT_DIR/.env"
fi

ENVIRONMENT=${1:-production}

if [ "$ENVIRONMENT" = "production" ]; then
  # Use WEBHOOK_URL from .env if available, otherwise use default
  BASE_URL="${WEBHOOK_URL:-https://marketing.aitriathlonplan.com}"
  echo "🚀 Setting up webhook for PRODUCTION: $BASE_URL"
elif [ "$ENVIRONMENT" = "local" ]; then
  BASE_URL="http://localhost:3000"
  echo "🏠 Setting up webhook for LOCAL: $BASE_URL"
  echo "⚠️  WARNING: Local webhooks won't work without ngrok/cloudflare tunnel!"
else
  echo "❌ Invalid environment. Use: production or local"
  exit 1
fi

WEBHOOK_URL="$BASE_URL/webhook/telegram"

echo ""
echo "📡 Setting webhook to: $WEBHOOK_URL"
echo ""

# Set the webhook
RESPONSE=$(curl -s -X POST "$BASE_URL/webhook/set" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"$WEBHOOK_URL\"}")

echo "Response: $RESPONSE"
echo ""

# Verify webhook info
echo "🔍 Verifying webhook configuration..."
curl -s "$BASE_URL/webhook/info" | jq '.' || echo "Note: Install jq for pretty JSON output"
echo ""

echo "✅ Webhook setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Test the webhook by triggering a scan"
echo "   2. Click buttons in Telegram to verify they work"
echo "   3. Check server logs for incoming webhook requests"
