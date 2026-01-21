#!/bin/bash
set -e

# TriPlan-AI Marketing Bot Systemd Service Installation Script
# This script installs a systemd service to run the bot as a continuous server with webhooks

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="triplanai-marketing"
USER=$(whoami)

echo -e "${GREEN}TriPlan-AI Marketing Bot - Systemd Service Installation${NC}"
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
    echo "Please create a .env file with your configuration before installing the service"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo -e "${YELLOW}Warning: node_modules not found. Running npm install...${NC}"
    cd "$PROJECT_DIR"
    npm install
fi

# Check if build directory exists, if not build it
if [ ! -d "$PROJECT_DIR/dist" ]; then
    echo -e "${YELLOW}Building TypeScript project...${NC}"
    cd "$PROJECT_DIR"
    npm run build
fi

echo -e "${GREEN}Creating systemd service file...${NC}"

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

# Ensure data directory exists with correct permissions
echo -e "${GREEN}Setting up data directory...${NC}"
mkdir -p "$PROJECT_DIR/data"
chmod 755 "$PROJECT_DIR/data"

# Reload systemd daemon
echo -e "${GREEN}Reloading systemd daemon...${NC}"
sudo systemctl daemon-reload

# Enable the service
echo -e "${GREEN}Enabling service...${NC}"
sudo systemctl enable $SERVICE_NAME.service

# Start the service
echo -e "${GREEN}Starting service...${NC}"
sudo systemctl start $SERVICE_NAME.service

# Wait a moment for the service to start
sleep 2

# Check service status
if sudo systemctl is-active --quiet $SERVICE_NAME.service; then
    echo ""
    echo -e "${GREEN}✓ Installation complete! Service is running.${NC}"
else
    echo ""
    echo -e "${RED}✗ Service failed to start. Check logs for details.${NC}"
    echo "Run: sudo journalctl -u $SERVICE_NAME.service -n 50"
    exit 1
fi

echo ""
echo "The bot server is now running with automatic scheduling:"
echo "  - Reddit scans: Every 4 hours"
echo "  - Twitter scans: Daily at 8 AM"
echo "  - Cleanup: Hourly"
echo "  - Webhook endpoint: Available at /webhook/telegram"
echo ""
echo "Useful commands:"
echo "  Check service status:      sudo systemctl status $SERVICE_NAME.service"
echo "  View live logs:            sudo journalctl -u $SERVICE_NAME.service -f"
echo "  Restart service:           sudo systemctl restart $SERVICE_NAME.service"
echo "  Stop service:              sudo systemctl stop $SERVICE_NAME.service"
echo "  Disable service:           sudo systemctl disable $SERVICE_NAME.service"
echo ""
echo "Next steps:"
echo "  1. Set up Telegram webhook:"
echo "     ./scripts/setup-webhook.sh production"
echo "  2. Test the server:"
echo "     curl http://localhost:3000/health"
echo ""
