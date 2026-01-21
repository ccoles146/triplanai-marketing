#!/bin/bash
set -e

# TriPlan-AI Marketing Bot Systemd Timer Installation Script
# This script installs a systemd timer to run the bot at 8am, 2pm, and 8pm daily

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="triplanai-marketing"
USER=$(whoami)

echo -e "${GREEN}TriPlan-AI Marketing Bot - Systemd Timer Installation${NC}"
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
Description=TriPlan-AI Marketing Bot
After=network.target

[Service]
Type=oneshot
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node $PROJECT_DIR/dist/index.js
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

echo -e "${GREEN}Creating systemd timer file...${NC}"

# Create the timer file that triggers at 8am, 2pm, and 8pm
sudo tee /etc/systemd/system/$SERVICE_NAME.timer > /dev/null <<EOF
[Unit]
Description=TriPlan-AI Marketing Bot Timer
Requires=$SERVICE_NAME.service

[Timer]
# Run at 8:00 AM
OnCalendar=*-*-* 08:00:00
# Run at 2:00 PM (14:00)
OnCalendar=*-*-* 14:00:00
# Run at 8:00 PM (20:00)
OnCalendar=*-*-* 20:00:00

# Run immediately if system was off during scheduled time
Persistent=true

# Randomize start time by up to 5 minutes to avoid rate limits if running multiple instances
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

# Ensure data directory exists with correct permissions
echo -e "${GREEN}Setting up data directory...${NC}"
mkdir -p "$PROJECT_DIR/data"
chmod 755 "$PROJECT_DIR/data"

# Reload systemd daemon
echo -e "${GREEN}Reloading systemd daemon...${NC}"
sudo systemctl daemon-reload

# Enable the timer (but don't start the service immediately)
echo -e "${GREEN}Enabling timer...${NC}"
sudo systemctl enable $SERVICE_NAME.timer

# Start the timer
echo -e "${GREEN}Starting timer...${NC}"
sudo systemctl start $SERVICE_NAME.timer

echo ""
echo -e "${GREEN}✓ Installation complete!${NC}"
echo ""
echo "The bot will now run automatically at:"
echo "  - 8:00 AM"
echo "  - 2:00 PM (14:00)"
echo "  - 8:00 PM (20:00)"
echo ""
echo "Useful commands:"
echo "  Check timer status:        sudo systemctl status $SERVICE_NAME.timer"
echo "  View upcoming runs:        systemctl list-timers $SERVICE_NAME.timer"
echo "  Run manually now:          sudo systemctl start $SERVICE_NAME.service"
echo "  View logs:                 sudo journalctl -u $SERVICE_NAME.service -f"
echo "  Stop timer:                sudo systemctl stop $SERVICE_NAME.timer"
echo "  Disable timer:             sudo systemctl disable $SERVICE_NAME.timer"
echo ""
echo "Next scheduled run:"
systemctl list-timers $SERVICE_NAME.timer --no-pager
