#!/bin/bash
set -e

# TriPlan-AI Marketing Bot Systemd Timer Uninstallation Script

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SERVICE_NAME="triplanai-marketing"

echo -e "${YELLOW}TriPlan-AI Marketing Bot - Systemd Timer Uninstallation${NC}"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}Error: Do not run this script as root${NC}"
    echo "Run as the same user who installed the service"
    exit 1
fi

# Stop the timer if running
echo -e "${GREEN}Stopping timer...${NC}"
sudo systemctl stop $SERVICE_NAME.timer 2>/dev/null || true

# Disable the timer
echo -e "${GREEN}Disabling timer...${NC}"
sudo systemctl disable $SERVICE_NAME.timer 2>/dev/null || true

# Stop the service if running
echo -e "${GREEN}Stopping service...${NC}"
sudo systemctl stop $SERVICE_NAME.service 2>/dev/null || true

# Remove systemd files
echo -e "${GREEN}Removing systemd files...${NC}"
sudo rm -f /etc/systemd/system/$SERVICE_NAME.service
sudo rm -f /etc/systemd/system/$SERVICE_NAME.timer

# Reload systemd daemon
echo -e "${GREEN}Reloading systemd daemon...${NC}"
sudo systemctl daemon-reload

# Reset failed services
sudo systemctl reset-failed 2>/dev/null || true

echo ""
echo -e "${GREEN}✓ Uninstallation complete!${NC}"
echo ""
echo "The systemd timer and service have been removed."
echo ""
echo -e "${YELLOW}Note: The project files and data directory were NOT deleted.${NC}"
echo "To completely remove the bot:"
echo "  - Delete the project directory"
echo "  - Remove any SQLite database files in the data/ directory"
