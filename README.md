# TriPlan-AI Marketing Bot

Self-hosted Node.js application that automates triathlon-related social media marketing for TriPlanAI. It scans Reddit and Twitter for relevant posts, uses Ollama (local LLM) to generate contextual replies, and sends them to Telegram for human approval before posting.

## Features

- **Automated Content Discovery**: Scans Reddit and Twitter for triathlon-related discussions
- **AI-Powered Replies**: Uses local Ollama LLM to generate contextual, helpful responses
- **Human-in-the-Loop**: All replies require approval via Telegram before posting
- **Smart Ranking**: Prioritizes questions and high-engagement posts
- **Cost-Optimized**: Twitter scanning limited to 1×/day ($0.10/day, $3/month)
- **Platform-Specific Scheduling**: Reddit scans every 4 hours (free), Twitter once daily
- **Rate Limiting**: Built-in safeguards to avoid spam and respect platform limits
- **Flexible Deployment**: Run as continuous server with cron, or as systemd timer

## Prerequisites

### Required
- Node.js 20+
- Ollama with a compatible model (e.g., `llama3.1:8b`, `llama2:7b`)
  ```bash
  # Install Ollama (if not already installed)
  curl -fsSL https://ollama.com/install.sh | sh

  # Pull a model
  ollama pull llama3.1:8b
  ```
- Telegram Bot (for approval workflow)

### Optional (per platform)
- **Reddit**: API credentials (OAuth app) - If not provided, uses public RSS feeds
- **Twitter**: API credentials (Bearer token) - Required for Twitter scanning
- **Pexels**: API key for image suggestions

## Installation

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd triplanai-marketing
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and configure your credentials:

```bash
cp .env.example .env
nano .env  # or your preferred editor
```

**Required:**
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` - For human approval workflow
- `OLLAMA_HOST` (default: `http://localhost:11434`)
- `OLLAMA_MODEL` (default: `llama3.1:8b`)

**Optional (Reddit):**
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` - For API access (provides engagement metrics)
- `REDDIT_USERNAME`, `REDDIT_PASSWORD` - For automated posting (otherwise uses manual URL method)
- If Reddit credentials are omitted, the bot will use public RSS feeds (no authentication required)

**Optional (Twitter):**
- `TWITTER_BEARER_TOKEN` - For scanning (required if you want Twitter scanning)
- `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` - For posting

**Optional (Other):**
- `PEXELS_API_KEY` - For image suggestions
- `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` - For cross-posting to Facebook

### 3. Build the Project

```bash
npm run build
```

### 4. Choose Deployment Mode

#### Option A: Systemd Service (RECOMMENDED for production with webhooks)

Run as a continuous server with built-in cron scheduling and webhook support:

```bash
./install-systemd-service.sh
```

This will:
- Create a systemd service that runs continuously
- Enable automatic restart on failure
- Set up built-in scheduling (Reddit every 4h, Twitter daily at 8 AM)
- Enable Telegram webhook support (buttons work!)
- Provide HTTP API endpoints for testing

**After installation, set up the webhook:**

```bash
./scripts/setup-webhook.sh production
```

**Benefits:**
- ✅ Telegram buttons work (approve/decline)
- ✅ HTTP API for manual triggers
- ✅ Real-time monitoring
- ✅ Auto-restart on crashes
- ✅ Optimized Twitter costs ($0.10/day)

#### Option B: Systemd Timer (One-shot executions)

Use systemd timer for periodic one-shot executions:

```bash
./install-systemd-timer.sh
```

Runs at 8 AM, 2 PM, 8 PM daily as separate executions.

**Limitations:**
- ❌ No webhook support (buttons won't work)
- ❌ No HTTP API
- ✅ Lower resource usage
- ✅ Simpler architecture

**Note:** The scripts require `sudo` access to create systemd files, but the service runs as your user.

## Usage

### Manual Execution

Run the bot manually for testing:

```bash
npm run start
```

Or run in development mode with hot reload:

```bash
npm run dev
```

### Manual Trigger via API

The bot includes several HTTP endpoints for manual triggering and testing:

#### 1. Trigger Platform-Specific Scans

```bash
# Scan all platforms (Reddit + Twitter)
curl -X POST http://localhost:3000/test/scan

# Scan Reddit only (free - no API costs)
curl -X POST http://localhost:3000/test/scan/reddit

# Scan Twitter only (costs $0.10)
curl -X POST http://localhost:3000/test/scan/twitter
```

#### 2. Preview Top Candidates (Dry Run)
View the top candidates without generating replies or posting:

```bash
curl http://localhost:3000/test/candidates
```

#### 3. List Pending Replies
See what replies are waiting for approval:

```bash
curl http://localhost:3000/test/pending
```

#### 4. Test Telegram Connection
Send a test message to your Telegram chat:

```bash
curl -X POST http://localhost:3000/test/telegram
```

#### 5. Webhook Management

```bash
# Set webhook (required for Telegram buttons to work)
curl -X POST http://localhost:3000/webhook/set \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-domain.com/webhook/telegram"}'

# Check webhook status
curl http://localhost:3000/webhook/info

# Delete webhook
curl -X POST http://localhost:3000/webhook/delete
```

**Note:** Replace `localhost:3000` with your server's address and port if different.

### Systemd Service Management (Continuous Server)

After installing the systemd service, use these commands:

```bash
# Check service status
sudo systemctl status triplanai-marketing.service

# View live logs
sudo journalctl -u triplanai-marketing.service -f

# View recent logs
sudo journalctl -u triplanai-marketing.service -n 100

# Restart service (after code updates)
sudo systemctl restart triplanai-marketing.service

# Stop service
sudo systemctl stop triplanai-marketing.service

# Disable automatic startup
sudo systemctl disable triplanai-marketing.service

# Uninstall service
./uninstall-systemd-service.sh
```

### Systemd Timer Management (One-shot Executions)

After installing the systemd timer, use these commands:

```bash
# Check timer status
sudo systemctl status triplanai-marketing.timer

# View upcoming scheduled runs
systemctl list-timers triplanai-marketing.timer

# Run the bot immediately (manual trigger - doesn't affect scheduled runs)
sudo systemctl start triplanai-marketing.service

# View logs (live tail)
sudo journalctl -u triplanai-marketing.service -f

# View recent logs
sudo journalctl -u triplanai-marketing.service -n 100

# Stop the timer
sudo systemctl stop triplanai-marketing.timer

# Disable automatic runs
sudo systemctl disable triplanai-marketing.timer

# Uninstall timer
./uninstall-systemd-timer.sh
```

**Manual Trigger Options:**
1. **Via systemd**: `sudo systemctl start triplanai-marketing.service` - Runs a one-time scan
2. **Via API** (if server is running): `curl -X POST http://localhost:3000/test/scan`
3. **Direct execution**: `npm run start` in the project directory

### Uninstallation

To remove the systemd timer:

```bash
./uninstall-systemd-timer.sh
```

This removes the systemd files but keeps your project directory and data intact.

## Project Structure

```
triplanai-marketing/
├── src/
│   ├── index.ts              # Express server & cron scheduler
│   ├── scanners/             # Reddit, Twitter scanners
│   ├── services/             # Core business logic
│   │   ├── ollama.ts         # LLM integration
│   │   ├── ranking.ts        # Post scoring & filtering
│   │   ├── reply-generator.ts # Reply generation
│   │   ├── telegram.ts       # Approval workflow
│   │   └── rate-limiter.ts   # Rate limiting & deduplication
│   ├── handlers/             # Request handlers
│   ├── lib/                  # Utilities & types
│   └── test/                 # Test suites
├── data/                     # SQLite database storage
├── .env                      # Environment configuration
└── install-systemd-timer.sh # Systemd timer installer
```

## Configuration

### Subreddits Monitored

Edit `src/lib/keywords.ts` to customize:
- Subreddits to scan
- Keywords for relevance matching
- Question detection patterns
- Spam/exclusion patterns

### Ranking Weights

Adjust post ranking algorithm in `src/lib/keywords.ts`:
- Platform-specific weights (Twitter prioritizes recency)
- Keyword matching importance
- Engagement scoring
- Question detection

### Rate Limits

Configure in `src/lib/keywords.ts`:
- Requests per time window per platform
- Daily post limits
- Platform-specific constraints

## Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Type checking
npm run typecheck
```

## Approval Workflow

1. Bot scans social media platforms at scheduled times
2. Posts are ranked by relevance, engagement, and question detection
3. Top candidates get AI-generated replies
4. Replies are sent to Telegram with approve/decline buttons
5. On approval:
   - Bot posts the reply to the platform
   - Tracks posted replies to avoid duplicates
6. On decline:
   - Reply is discarded
   - Post is marked as processed to avoid re-generating

## Security & Privacy

- All credentials stored in `.env` (not committed to git)
- SQLite database stores deduplication data only (no PII)
- Systemd service runs with security hardening (`NoNewPrivileges`, `ProtectSystem`)
- Rate limiting prevents API abuse
- Human approval required for all posts

## Troubleshooting

### Ollama Connection Issues

```bash
# Check if Ollama is running
systemctl status ollama

# Test Ollama manually
ollama run llama3.1:8b "Hello"

# Check logs
sudo journalctl -u triplanai-marketing.service -n 50
```

### Timer Not Running

```bash
# Check timer status
systemctl list-timers --all | grep triplanai

# Verify timer is enabled
sudo systemctl is-enabled triplanai-marketing.timer

# Check for errors
sudo journalctl -u triplanai-marketing.timer -n 50
```

### Database Issues

The SQLite database is stored in `data/marketing.db`. To reset:

```bash
rm data/marketing.db
# Database will be recreated on next run
```

## License

[Your License Here]

## Platform Support

### Currently Supported
- **Reddit**: Full support for scanning and posting replies
  - **API Mode**: When Reddit API credentials are provided (CLIENT_ID, CLIENT_SECRET, USER_AGENT)
    - Full access to post metadata (scores, comments, engagement)
    - Can post replies via API (if USERNAME and PASSWORD also provided)
  - **RSS Mode**: When Reddit API credentials are missing
    - Scans subreddits via public RSS feeds (no authentication required)
    - No engagement metrics available (scores/comments)
    - Manual posting via URL generation
- **Twitter**: Full support for scanning and posting replies

### Not Yet Implemented
- **Instagram**: Scanning and interaction capabilities are planned but not yet implemented
  - Environment variables (`INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`) are defined for future use
  - Type definitions include Instagram as a platform
  - No actual scanner or posting functionality exists yet

- **Facebook**: Cross-posting capabilities only
  - Environment variables (`FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`) allow cross-posting approved content
  - No scanning or discovery functionality
  - Used only for sharing approved content to your Facebook page

## Support

For issues or questions, please open an issue on GitHub or contact the maintainers.
