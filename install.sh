#!/bin/bash
set -e

# TriPlan-AI Marketing Bot - Unified Installation Script
# This script handles the complete installation: systemd service + Telegram webhook setup

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="triplanai-marketing"

# Handle user management for LXC environments
if [ "$EUID" -eq 0 ]; then
    # Running as root - create dedicated user for the service
    SERVICE_USER="triplanai"

    echo -e "${YELLOW}Running as root. Creating dedicated user for service...${NC}"

    # Create user if it doesn't exist
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd --system --no-create-home --shell /bin/false "$SERVICE_USER" || true
        echo -e "${GREEN}✓ Created user: $SERVICE_USER${NC}"
    else
        echo -e "${GREEN}✓ User already exists: $SERVICE_USER${NC}"
    fi

    USER="$SERVICE_USER"
else
    # Running as regular user
    USER=$(whoami)
fi

echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}TriPlan-AI Marketing Bot${NC}"
echo -e "${GREEN}Unified Installation Script${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo "Project directory: $PROJECT_DIR"
echo "Service will run as user: $USER"
echo ""

# Check if .env file exists, create from example if not
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${YELLOW}.env file not found. Creating from example...${NC}"
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
        echo -e "${GREEN}✓ Created .env file${NC}"
        echo -e "${YELLOW}⚠ Please edit .env with your credentials to enable full functionality${NC}"
    else
        echo -e "${RED}Error: .env.example not found${NC}"
        exit 1
    fi
fi

# Parse command line arguments
SKIP_WEBHOOK=false
ENVIRONMENT="production"

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-webhook)
            SKIP_WEBHOOK=true
            shift
            ;;
        --local)
            ENVIRONMENT="local"
            shift
            ;;
        --production)
            ENVIRONMENT="production"
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--skip-webhook] [--local|--production]"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}Step 1/4: Checking dependencies...${NC}"

# Check if this is a pre-built release (has dist/ and node_modules/)
if [ -d "$PROJECT_DIR/dist" ] && [ -d "$PROJECT_DIR/node_modules" ]; then
    echo -e "${GREEN}✓ Using pre-built release${NC}"
    echo "  - dist/ directory found"
    echo "  - node_modules/ found"
else
    # Not a pre-built release, need to build from source
    echo -e "${YELLOW}Building from source...${NC}"

    # Check if node_modules exists
    if [ ! -d "$PROJECT_DIR/node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies...${NC}"
        cd "$PROJECT_DIR"
        npm install
    else
        echo -e "${GREEN}✓ Dependencies installed${NC}"
    fi

    # Check if build directory exists, if not build it
    if [ ! -d "$PROJECT_DIR/dist" ]; then
        echo -e "${YELLOW}Building TypeScript project...${NC}"
        cd "$PROJECT_DIR"
        npm run build
    else
        echo -e "${GREEN}✓ Project built${NC}"
    fi
fi

echo ""
echo -e "${BLUE}Step 2/4: Setting up systemd service...${NC}"

# Create the service file
sudo tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null <<EOF
[Unit]
Description=TriPlan-AI Marketing Bot Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node $PROJECT_DIR/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# Environment
Environment=NODE_ENV=production

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$PROJECT_DIR/data

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}✓ Service file created${NC}"

# Ensure data directory exists with correct permissions
echo -e "${YELLOW}Setting up data directory...${NC}"
mkdir -p "$PROJECT_DIR/data"
chmod 755 "$PROJECT_DIR/data"

# Set ownership if running as root
if [ "$EUID" -eq 0 ]; then
    chown -R "$USER:$USER" "$PROJECT_DIR"
    echo -e "${GREEN}✓ Set ownership to $USER${NC}"
fi

# Reload systemd daemon
echo -e "${YELLOW}Reloading systemd daemon...${NC}"
sudo systemctl daemon-reload

# Enable the service
echo -e "${YELLOW}Enabling service...${NC}"
sudo systemctl enable $SERVICE_NAME.service

# Start the service
echo -e "${YELLOW}Starting service...${NC}"
sudo systemctl start $SERVICE_NAME.service

# Wait a moment for the service to start
sleep 2

# Check service status
SYSTEMCTL_CMD="systemctl"
[ "$EUID" -ne 0 ] && SYSTEMCTL_CMD="sudo systemctl"

if $SYSTEMCTL_CMD is-active --quiet $SERVICE_NAME.service; then
    echo -e "${GREEN}✓ Service is running${NC}"
else
    echo ""
    echo -e "${YELLOW}⚠ Service may have failed to start. This is normal if .env is not fully configured.${NC}"
    echo "Check logs: ${SYSTEMCTL_CMD/systemctl/journalctl} -u $SERVICE_NAME.service -n 50"
    echo ""
    echo -e "${YELLOW}Common reasons for startup failure:${NC}"
    echo "  - Missing required credentials in .env (TELEGRAM_BOT_TOKEN, etc.)"
    echo "  - Ollama not running or model not available"
    echo "  - Port 3000 already in use"
fi

echo ""
echo -e "${BLUE}Step 3/4: Verifying server health...${NC}"

# Wait for server to be ready
sleep 3

# Check if server is responding
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server is responding${NC}"
else
    echo -e "${YELLOW}⚠ Server health check failed (this may be normal if health endpoint doesn't exist)${NC}"
fi

echo ""
echo -e "${BLUE}Step 4/4: Setting up Telegram webhook...${NC}"

if [ "$SKIP_WEBHOOK" = true ]; then
    echo -e "${YELLOW}Skipping webhook setup (--skip-webhook flag)${NC}"
else
    # Run the webhook setup script
    if [ -f "$PROJECT_DIR/scripts/setup-webhook.sh" ]; then
        bash "$PROJECT_DIR/scripts/setup-webhook.sh" "$ENVIRONMENT"
    else
        echo -e "${YELLOW}⚠ Webhook setup script not found at $PROJECT_DIR/scripts/setup-webhook.sh${NC}"
        echo "You can set up the webhook manually later by running:"
        echo "  ./scripts/setup-webhook.sh $ENVIRONMENT"
    fi
fi

echo ""
echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}✓ Installation Complete!${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Check if .env has placeholder values
ENV_INCOMPLETE=false
if grep -q "your_telegram_bot_token_here" "$PROJECT_DIR/.env" 2>/dev/null || \
   grep -q "your_telegram_chat_id_here" "$PROJECT_DIR/.env" 2>/dev/null; then
    ENV_INCOMPLETE=true
fi

if [ "$ENV_INCOMPLETE" = true ]; then
    echo -e "${YELLOW}⚠ IMPORTANT: Configuration Required${NC}"
    echo ""
    echo "Your .env file needs to be configured with real credentials:"
    echo ""
    echo -e "${BLUE}Required (minimum):${NC}"
    echo "  - TELEGRAM_BOT_TOKEN     (for approval workflow)"
    echo "  - TELEGRAM_CHAT_ID       (your Telegram chat ID)"
    echo "  - OLLAMA_HOST            (default: http://localhost:11434)"
    echo ""
    echo -e "${BLUE}Optional (per platform):${NC}"
    echo "  - Reddit: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD"
    echo "  - Twitter: TWITTER_BEARER_TOKEN, TWITTER_API_KEY, etc."
    echo ""
    echo -e "${YELLOW}Edit your configuration:${NC}"
    echo "  nano $PROJECT_DIR/.env"
    echo ""
    echo -e "${YELLOW}Then restart the service:${NC}"
    echo "  ${SYSTEMCTL_CMD} restart $SERVICE_NAME.service"
    echo ""
else
    echo "The bot server is now running with automatic scheduling:"
    echo "  - Reddit scans: Every 4 hours"
    echo "  - Twitter scans: Daily at 8 AM"
    echo "  - Cleanup: Hourly"
    echo "  - Webhook endpoint: Available at /webhook/telegram"
    echo ""
fi

echo -e "${YELLOW}Useful commands:${NC}"
SUDO_PREFIX=""
[ "$EUID" -ne 0 ] && SUDO_PREFIX="sudo "
echo "  Check service status:      ${SUDO_PREFIX}systemctl status $SERVICE_NAME.service"
echo "  View live logs:            ${SUDO_PREFIX}journalctl -u $SERVICE_NAME.service -f"
echo "  Restart service:           ${SUDO_PREFIX}systemctl restart $SERVICE_NAME.service"
echo "  Stop service:              ${SUDO_PREFIX}systemctl stop $SERVICE_NAME.service"
echo "  Disable service:           ${SUDO_PREFIX}systemctl disable $SERVICE_NAME.service"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  Edit credentials:          nano $PROJECT_DIR/.env"
echo "  After editing, restart:    ${SUDO_PREFIX}systemctl restart $SERVICE_NAME.service"
echo ""
echo -e "${YELLOW}Manual webhook setup:${NC}"
echo "  Production:                cd $PROJECT_DIR && ./scripts/setup-webhook.sh production"
echo "  Local (with tunnel):       cd $PROJECT_DIR && ./scripts/setup-webhook.sh local"
echo ""
