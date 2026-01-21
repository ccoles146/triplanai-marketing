#!/bin/bash
set -e

# TriPlan-AI Marketing Bot Systemd Service Uninstallation Script

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SERVICE_NAME="triplanai-marketing"

echo -e "${YELLOW}TriPlan-AI Marketing Bot - Systemd Service Uninstallation${NC}"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}Error: Do not run this script as root${NC}"
    echo "Run as your regular user"
    exit 1
fi

# Stop the service if it's running
echo -e "${GREEN}Stopping service...${NC}"
sudo systemctl stop $SERVICE_NAME.service 2>/dev/null || true

# Disable the service
echo -e "${GREEN}Disabling service...${NC}"
sudo systemctl disable $SERVICE_NAME.service 2>/dev/null || true

# Remove service file
echo -e "${GREEN}Removing service file...${NC}"
sudo rm -f /etc/systemd/system/$SERVICE_NAME.service

# Reload systemd daemon
echo -e "${GREEN}Reloading systemd daemon...${NC}"
sudo systemctl daemon-reload

# Reset failed units
sudo systemctl reset-failed 2>/dev/null || true

echo ""
echo -e "${GREEN}✓ Uninstallation complete!${NC}"
echo ""
echo "The systemd service has been removed."
echo "Your project files and data remain intact."
echo ""
