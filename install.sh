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
USER=$(whoami)

echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}TriPlan-AI Marketing Bot${NC}"
echo -e "${GREEN}Unified Installation Script${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo "Project directory: $PROJECT_DIR"
echo "Service will run as user: $USER"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}Error: Do not run this script as root${NC}"
    echo "Run as the user who will execute the bot (current: $USER)"
    exit 1
fi

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Please create a .env file with your configuration before installing"
    echo "You can copy .env.example to .env and fill in your credentials"
    exit 1
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

# Check if node_modules exists
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo -e "${YELLOW}Warning: node_modules not found. Running npm install...${NC}"
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
if sudo systemctl is-active --quiet $SERVICE_NAME.service; then
    echo -e "${GREEN}✓ Service is running${NC}"
else
    echo ""
    echo -e "${RED}✗ Service failed to start. Check logs for details.${NC}"
    echo "Run: sudo journalctl -u $SERVICE_NAME.service -n 50"
    exit 1
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
echo "The bot server is now running with automatic scheduling:"
echo "  - Reddit scans: Every 4 hours"
echo "  - Twitter scans: Daily at 8 AM"
echo "  - Cleanup: Hourly"
echo "  - Webhook endpoint: Available at /webhook/telegram"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  Check service status:      sudo systemctl status $SERVICE_NAME.service"
echo "  View live logs:            sudo journalctl -u $SERVICE_NAME.service -f"
echo "  Restart service:           sudo systemctl restart $SERVICE_NAME.service"
echo "  Stop service:              sudo systemctl stop $SERVICE_NAME.service"
echo "  Disable service:           sudo systemctl disable $SERVICE_NAME.service"
echo ""
echo -e "${YELLOW}Manual webhook setup:${NC}"
echo "  Production:                ./scripts/setup-webhook.sh production"
echo "  Local (with tunnel):       ./scripts/setup-webhook.sh local"
echo ""
