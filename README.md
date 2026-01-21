# TriPlan-AI Marketing Bot

Self-hosted Node.js application that automates triathlon-related social media marketing for TriPlanAI. It scans Reddit and Twitter for relevant posts, uses Ollama (local LLM) to generate contextual replies, and sends them to Telegram for human approval before posting.

## Features

- **Automated Content Discovery**: Scans Reddit and Twitter for triathlon-related discussions
- **AI-Powered Replies**: Uses local Ollama LLM to generate contextual, helpful responses
- **Human-in-the-Loop**: All replies require approval via Telegram before posting
- **Smart Ranking**: Prioritizes questions and high-engagement posts
- **Rate Limiting**: Built-in safeguards to avoid spam and respect platform limits
- **Scheduled Execution**: Systemd timer runs automatically at scheduled times

## Prerequisites

- Node.js 20+
- Ollama running locally with `llama3.1:8b` model
  ```bash
  # Install Ollama (if not already installed)
  curl -fsSL https://ollama.com/install.sh | sh

  # Pull the model
  ollama pull llama3.1:8b
  ```
- Reddit API credentials (OAuth app)
- Twitter API credentials (Bearer token)
- Telegram Bot (for approval workflow)
- Optional: Pexels API key (for images)

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

Required environment variables:
- `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT`
- `TWITTER_BEARER_TOKEN`, `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `OLLAMA_HOST` (default: `http://localhost:11434`)
- `OLLAMA_MODEL` (default: `llama3.1:8b`)

### 3. Build the Project

```bash
npm run build
```

### 4. Install Systemd Timer (Automated Scheduling)

The bot includes an installation script that sets up a systemd timer to run automatically at 8am, 2pm, and 8pm daily:

```bash
./install-systemd-timer.sh
```

This will:
- Create systemd service and timer files
- Set up proper permissions
- Enable and start the timer
- Configure the bot to run at scheduled times

**Note:** The script requires `sudo` access to create systemd files, but the service itself runs as your user.

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

### Systemd Timer Management

After installing the systemd timer, use these commands:

```bash
# Check timer status
sudo systemctl status triplanai-marketing.timer

# View upcoming scheduled runs
systemctl list-timers triplanai-marketing.timer

# Run the bot immediately (manual trigger)
sudo systemctl start triplanai-marketing.service

# View logs
sudo journalctl -u triplanai-marketing.service -f

# Stop the timer
sudo systemctl stop triplanai-marketing.timer

# Disable automatic runs
sudo systemctl disable triplanai-marketing.timer
```

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
