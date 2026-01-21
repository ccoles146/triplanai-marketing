#!/bin/bash
set -e

# TriPlan-AI Marketing Bot - Quick Install from GitHub Release
# This script downloads the latest pre-built release and installs it

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REPO="ccoles146/triplanai-marketing"  # Update this with your repo
INSTALL_DIR="${INSTALL_DIR:-$HOME/triplanai-marketing}"
VERSION="${VERSION:-latest}"
INSTALL_PARENT_DIR=$(dirname "$INSTALL_DIR")
INSTALL_BASENAME=$(basename "$INSTALL_DIR")

echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}TriPlan-AI Marketing Bot${NC}"
echo -e "${GREEN}Quick Install from Release${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Check if running as root (not recommended)
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}Warning: Running as root. Consider using a regular user.${NC}"
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
        --version)
            VERSION="$2"
            shift 2
            ;;
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--skip-webhook] [--local|--production] [--version VERSION] [--install-dir DIR]"
            exit 1
            ;;
    esac
done

echo "Installation directory: $INSTALL_DIR"
echo "Release version: $VERSION"
echo ""

# Create parent directory and work there
# We'll extract the tarball in the parent, which creates the 'triplanai-marketing' subdirectory
mkdir -p "$INSTALL_PARENT_DIR"
cd "$INSTALL_PARENT_DIR"

# Remove old installation if it exists
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Removing existing installation at $INSTALL_DIR${NC}"
    rm -rf "$INSTALL_DIR"
fi

echo -e "${BLUE}Step 1/4: Downloading release...${NC}"

# Determine download URL
if [ "$VERSION" = "latest" ]; then
    DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/triplanai-marketing-linux-x64.tar.gz"
    CHECKSUM_URL="https://github.com/$REPO/releases/latest/download/triplanai-marketing-linux-x64.tar.gz.sha256"
else
    DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/triplanai-marketing-linux-x64.tar.gz"
    CHECKSUM_URL="https://github.com/$REPO/releases/download/$VERSION/triplanai-marketing-linux-x64.tar.gz.sha256"
fi

# Download release
echo "Downloading from: $DOWNLOAD_URL"
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

echo -e "${GREEN}✓ Download complete${NC}"

echo ""
echo -e "${BLUE}Step 2/4: Verifying checksum...${NC}"

# The checksum file contains the original filename, but we renamed it
# Need to adjust the checksum file or use a different approach
EXPECTED_HASH=$(cut -d' ' -f1 triplanai-marketing.tar.gz.sha256)
ACTUAL_HASH=$(sha256sum triplanai-marketing.tar.gz | cut -d' ' -f1)

if [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ]; then
    echo -e "${GREEN}✓ Checksum verified${NC}"
else
    echo -e "${RED}✗ Checksum verification failed!${NC}"
    echo "Expected: $EXPECTED_HASH"
    echo "Actual:   $ACTUAL_HASH"
    echo "The downloaded file may be corrupted or tampered with."
    exit 1
fi

echo ""
echo -e "${BLUE}Step 3/4: Extracting archive...${NC}"

# Extract the tarball (creates triplanai-marketing/ directory)
tar -xzf triplanai-marketing.tar.gz

# Verify extraction created the expected directory
if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${RED}Error: Extraction did not create $INSTALL_DIR${NC}"
    echo "Contents of parent directory:"
    ls -la
    exit 1
fi

echo -e "${GREEN}✓ Extraction complete${NC}"

echo ""
echo -e "${BLUE}Step 4/4: Running installation...${NC}"

# Change to the installation directory
cd "$INSTALL_DIR"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}No .env file found. Please configure your environment:${NC}"
    echo "1. Copy the example: cp .env.example .env"
    echo "2. Edit with your credentials: nano .env"
    echo ""
    read -p "Do you want to create .env now? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cp .env.example .env
        echo -e "${GREEN}.env file created. Please edit it with your credentials.${NC}"
        echo "Then run: cd $INSTALL_DIR && ./install.sh"
        exit 0
    else
        echo "Please create .env file before running ./install.sh"
        echo "cd $INSTALL_DIR && cp .env.example .env && nano .env && ./install.sh"
        exit 1
    fi
fi

# Run the installation script
if [ -f "./install.sh" ]; then
    if [ "$SKIP_WEBHOOK" = true ]; then
        ./install.sh --skip-webhook
    elif [ "$ENVIRONMENT" = "local" ]; then
        ./install.sh --local
    else
        ./install.sh --production
    fi
else
    echo -e "${RED}Error: install.sh not found in the extracted archive${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Installation complete!${NC}"
echo ""
echo "Cleaning up downloaded files..."
cd "$INSTALL_PARENT_DIR"
rm -f triplanai-marketing.tar.gz triplanai-marketing.tar.gz.sha256

echo -e "${GREEN}All done!${NC}"
