#!/bin/bash
set -e

# TriPlan-AI Marketing Bot - Update Script
# Similar to Proxmox Community Scripts pattern

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the absolute path to the project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="triplanai-marketing"
BACKUP_DIR="$PROJECT_DIR/backup-$(date +%Y%m%d-%H%M%S)"

echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}TriPlan-AI Marketing Bot${NC}"
echo -e "${GREEN}Update Script${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Detect service user
if [ "$EUID" -eq 0 ]; then
    # Running as root - use the user from the systemd service
    if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
        SERVICE_USER=$(grep "^User=" /etc/systemd/system/$SERVICE_NAME.service | cut -d= -f2)
        echo "Running as root. Service user: $SERVICE_USER"
    else
        SERVICE_USER="triplanai"
        echo "Running as root. Default service user: $SERVICE_USER"
    fi
else
    SERVICE_USER=$(whoami)
    echo "Running as user: $SERVICE_USER"
fi

# Detect installation type
UPDATE_METHOD="unknown"

if [ -d "$PROJECT_DIR/.git" ]; then
    UPDATE_METHOD="git"
    echo "Detected: Git repository installation"
elif [ -f "$PROJECT_DIR/dist/index.js" ] && [ -d "$PROJECT_DIR/node_modules" ]; then
    UPDATE_METHOD="release"
    echo "Detected: Pre-built release installation"
else
    echo -e "${RED}Error: Unable to determine installation type${NC}"
    echo "Expected either .git directory (source) or dist/ + node_modules/ (release)"
    exit 1
fi

echo "Update method: $UPDATE_METHOD"
echo "Project directory: $PROJECT_DIR"
echo ""

# Parse command line arguments
SKIP_BACKUP=false
SKIP_RESTART=false
VERSION="latest"

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-backup)
            SKIP_BACKUP=true
            shift
            ;;
        --skip-restart)
            SKIP_RESTART=true
            shift
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--skip-backup] [--skip-restart] [--version VERSION]"
            exit 1
            ;;
    esac
done

# Step 1: Backup critical data
if [ "$SKIP_BACKUP" = false ]; then
    echo -e "${BLUE}Step 1/6: Backing up critical data...${NC}"
    mkdir -p "$BACKUP_DIR"

    # Backup .env file
    if [ -f "$PROJECT_DIR/.env" ]; then
        cp "$PROJECT_DIR/.env" "$BACKUP_DIR/.env"
        echo -e "${GREEN}✓ Backed up .env${NC}"
    fi

    # Backup database
    if [ -d "$PROJECT_DIR/data" ]; then
        cp -r "$PROJECT_DIR/data" "$BACKUP_DIR/data"
        echo -e "${GREEN}✓ Backed up data directory${NC}"
    fi

    echo "Backup location: $BACKUP_DIR"
else
    echo -e "${YELLOW}Skipping backup (--skip-backup flag)${NC}"
fi

echo ""

# Step 2: Stop the service if it exists
echo -e "${BLUE}Step 2/6: Stopping service...${NC}"

SYSTEMCTL_CMD="systemctl"
[ "$EUID" -ne 0 ] && SYSTEMCTL_CMD="sudo systemctl"

if $SYSTEMCTL_CMD is-active --quiet $SERVICE_NAME.service 2>/dev/null; then
    $SYSTEMCTL_CMD stop $SERVICE_NAME.service
    sleep 2
    echo -e "${GREEN}✓ Service stopped${NC}"
else
    echo -e "${YELLOW}Service not running or not installed${NC}"
fi

echo ""

# Step 3: Update the code
echo -e "${BLUE}Step 3/6: Updating application...${NC}"

if [ "$UPDATE_METHOD" = "git" ]; then
    # Git-based update
    echo "Pulling latest changes from git..."
    cd "$PROJECT_DIR"

    # Stash any local changes
    if ! git diff-index --quiet HEAD --; then
        echo -e "${YELLOW}Stashing local changes...${NC}"
        git stash
    fi

    git pull origin master
    echo -e "${GREEN}✓ Git pull complete${NC}"

elif [ "$UPDATE_METHOD" = "release" ]; then
    # Release-based update
    echo "Downloading latest release..."

    REPO="ccoles146/triplanai-marketing"
    TEMP_DIR=$(mktemp -d)

    # Determine download URL
    if [ "$VERSION" = "latest" ]; then
        DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/triplanai-marketing-linux-x64.tar.gz"
        CHECKSUM_URL="https://github.com/$REPO/releases/latest/download/triplanai-marketing-linux-x64.tar.gz.sha256"
    else
        DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/triplanai-marketing-linux-x64.tar.gz"
        CHECKSUM_URL="https://github.com/$REPO/releases/download/$VERSION/triplanai-marketing-linux-x64.tar.gz.sha256"
    fi

    # Download to temp directory
    cd "$TEMP_DIR"
    if command -v curl &> /dev/null; then
        curl -L -o triplanai-marketing.tar.gz "$DOWNLOAD_URL"
        curl -L -o triplanai-marketing.tar.gz.sha256 "$CHECKSUM_URL"
    elif command -v wget &> /dev/null; then
        wget -O triplanai-marketing.tar.gz "$DOWNLOAD_URL"
        wget -O triplanai-marketing.tar.gz.sha256 "$CHECKSUM_URL"
    else
        echo -e "${RED}Error: Neither curl nor wget is installed${NC}"
        exit 1
    fi

    # Verify checksum
    EXPECTED_HASH=$(cut -d' ' -f1 triplanai-marketing.tar.gz.sha256)
    ACTUAL_HASH=$(sha256sum triplanai-marketing.tar.gz | cut -d' ' -f1)

    if [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ]; then
        echo -e "${GREEN}✓ Checksum verified${NC}"
    else
        echo -e "${RED}✗ Checksum verification failed!${NC}"
        echo "Expected: $EXPECTED_HASH"
        echo "Actual:   $ACTUAL_HASH"
        rm -rf "$TEMP_DIR"
        exit 1
    fi

    # Extract to temp location
    tar -xzf triplanai-marketing.tar.gz

    # Remove old installation files (preserve .env and data/)
    echo "Removing old files..."
    cd "$PROJECT_DIR"
    find . -mindepth 1 -maxdepth 1 ! -name '.env' ! -name 'data' ! -name 'backup-*' ! -name '.git' -exec rm -rf {} +

    # Copy new files from extracted directory
    echo "Installing new files..."
    cp -r "$TEMP_DIR/triplanai-marketing"/* "$PROJECT_DIR/"

    # Cleanup
    rm -rf "$TEMP_DIR"

    echo -e "${GREEN}✓ Release update complete${NC}"
fi

echo ""

# Step 4: Install dependencies and build (if needed)
echo -e "${BLUE}Step 4/6: Installing dependencies...${NC}"

cd "$PROJECT_DIR"

if [ "$UPDATE_METHOD" = "git" ]; then
    # For git installations, always run npm install and build
    echo "Running npm install..."
    npm install

    echo "Building TypeScript..."
    npm run build

    echo -e "${GREEN}✓ Build complete${NC}"
elif [ "$UPDATE_METHOD" = "release" ]; then
    # Pre-built releases already have dist/ and node_modules/
    echo -e "${GREEN}✓ Using pre-built release${NC}"
fi

echo ""

# Step 5: Restore backed up data
echo -e "${BLUE}Step 5/6: Restoring data...${NC}"

if [ "$SKIP_BACKUP" = false ]; then
    # Restore .env if it was backed up (in case it was accidentally removed)
    if [ -f "$BACKUP_DIR/.env" ] && [ ! -f "$PROJECT_DIR/.env" ]; then
        cp "$BACKUP_DIR/.env" "$PROJECT_DIR/.env"
        echo -e "${GREEN}✓ Restored .env${NC}"
    fi

    # Note: data directory should not have been removed, but restore if needed
    if [ -d "$BACKUP_DIR/data" ] && [ ! -d "$PROJECT_DIR/data" ]; then
        cp -r "$BACKUP_DIR/data" "$PROJECT_DIR/"
        echo -e "${GREEN}✓ Restored data directory${NC}"
    fi

    # Set ownership if running as root
    if [ "$EUID" -eq 0 ]; then
        chown -R "$SERVICE_USER:$SERVICE_USER" "$PROJECT_DIR"
        echo -e "${GREEN}✓ Set ownership to $SERVICE_USER${NC}"
    fi
else
    echo -e "${YELLOW}No backup to restore${NC}"
fi

echo ""

# Step 6: Restart the service
if [ "$SKIP_RESTART" = false ]; then
    echo -e "${BLUE}Step 6/6: Starting service...${NC}"

    if $SYSTEMCTL_CMD list-unit-files | grep -q "$SERVICE_NAME.service"; then
        $SYSTEMCTL_CMD start $SERVICE_NAME.service
        sleep 2

        if $SYSTEMCTL_CMD is-active --quiet $SERVICE_NAME.service; then
            echo -e "${GREEN}✓ Service started successfully${NC}"
        else
            echo -e "${RED}✗ Service failed to start${NC}"
            echo "Check logs: ${SYSTEMCTL_CMD/systemctl/journalctl} -u $SERVICE_NAME.service -n 50"
            exit 1
        fi
    else
        echo -e "${YELLOW}Service not installed. Run ./install.sh to set up the service.${NC}"
    fi
else
    echo -e "${YELLOW}Skipping service restart (--skip-restart flag)${NC}"
fi

echo ""
echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}✓ Update Complete!${NC}"
echo -e "${BLUE}================================${NC}"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
SUDO_PREFIX=""
[ "$EUID" -ne 0 ] && SUDO_PREFIX="sudo "
echo "  Check service status:      ${SUDO_PREFIX}systemctl status $SERVICE_NAME.service"
echo "  View live logs:            ${SUDO_PREFIX}journalctl -u $SERVICE_NAME.service -f"
echo "  Restart service:           ${SUDO_PREFIX}systemctl restart $SERVICE_NAME.service"
echo ""
echo "Backup location: $BACKUP_DIR"
echo -e "${YELLOW}You can safely delete old backups when no longer needed.${NC}"
echo ""
