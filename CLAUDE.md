# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Self-hosted Node.js application that automates triathlon-related social media marketing for TriPlanAI. It scans Reddit and Twitter for relevant posts, uses Ollama (local LLM) to generate contextual replies, and sends them to Telegram for human approval before posting.

## Commands

```bash
npm run dev          # Start dev server with hot reload (tsx watch)
npm run start        # Run production build
npm run build        # Compile TypeScript to dist/
npm run test         # Run tests (vitest)
npm run test:watch   # Run tests in watch mode
npm run typecheck    # TypeScript type checking
```

## Architecture

### Entry Point
[src/index.ts](src/index.ts) - Express server entry point handling:
- **Scheduled scans**: node-cron job (`0 */4 * * *`) runs `runScan()` every 4 hours
- **HTTP endpoints**: `/webhook/telegram` for approval callbacks, `/test/*` for debugging, `/webhook/*` for bot management

### Core Flow
1. **Scanners** ([src/scanners/](src/scanners/)) - Fetch posts from Reddit/Twitter APIs
2. **Ranking** ([src/services/ranking.ts](src/services/ranking.ts)) - Score posts by keyword match, engagement, recency, and question detection
3. **Reply Generation** ([src/services/reply-generator.ts](src/services/reply-generator.ts)) - Uses Ollama (local Llama 3.1 8B) to generate platform-appropriate replies
4. **Telegram Approval** ([src/services/telegram.ts](src/services/telegram.ts)) - Sends drafts with inline approve/decline buttons
5. **Webhook Handler** ([src/handlers/webhook.ts](src/handlers/webhook.ts)) - Processes button clicks, posts approved replies, handles cross-posting

### Key Configurations
- [src/lib/keywords.ts](src/lib/keywords.ts) - Subreddits to scan, triathlon keywords, hashtags, spam patterns, platform-specific ranking weights
- [src/lib/types.ts](src/lib/types.ts) - TypeScript interfaces for posts, replies, callbacks
- [src/lib/env.ts](src/lib/env.ts) - Environment loading from `.env` and validation

### Storage
- [src/lib/db.ts](src/lib/db.ts) - SQLite database (stored in `data/marketing.db`)
- [src/services/rate-limiter.ts](src/services/rate-limiter.ts) - Rate limiting, deduplication, pending replies stored in SQLite

### LLM Integration
- [src/services/ollama.ts](src/services/ollama.ts) - Ollama client wrapper for local LLM inference
- Default model: `llama3.1:8b` (configurable via `OLLAMA_MODEL` env var)

## Environment Variables

Copy `.env.example` to `.env` and configure:
- Server: `PORT`, `OLLAMA_HOST`, `OLLAMA_MODEL`
- Reddit: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT`
- Twitter: `TWITTER_BEARER_TOKEN`, `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`
- Optional: `PEXELS_API_KEY`, `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`

## Prerequisites

- Node.js 20+
- Ollama running locally with `llama3.1:8b` model pulled (`ollama pull llama3.1:8b`)
