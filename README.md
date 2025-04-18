# Telegram Bot Cloudflare Worker

A Cloudflare Worker that integrates with a Telegram Bot to filter spam and manage silence consensus polls.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure your environment variables in `wrangler.toml`:

   ```toml
   [vars]
    TG_BOT_USERNAME = "your bot username"
    TG_SPAM_RE = "regular expression to detect spam message on username and text message"
    TG_ALLOWED_CHAT_USERNAMES = "allowed chat room to proceed"
    TG_SILENCE_CONSENSUS_COMMAND = "/silence"
    TG_SILENCE_CONSENSUS_MIN_COUNT = 3
    TG_SILENCE_CONSENSUS_POSITIVE_RATIO = 0.7
    TG_SILENCE_CONSENSUS_RESTRICT_DURATION = 259200
    TG_SILENCE_CONSENSUS_POLL_DURATION = 86400
   ```

3. Set up your secrets using Wrangler:
   ```bash
   npx wrangler secret put TG_BOT_TOKEN
   npx wrangler secret put TG_HOOK_SECRET
   ```
4. Set up D1 SQL

   create D1 database on cloudflare

   ```bash
   npx wrangler d1 create tg-bot-d1

   # paste the result to wrangler.toml
   ```

   create schema

   ```bash
   # local
   npx wrangler d1 execute tg-bot-d1 --local --file=./schema/schema.sql

   # remote
   npx wrangler d1 execute tg-bot-d1 --remote --file=./schema/schema.sql
   ```

## Development

To run the worker locally:

```bash
npm run dev
```

## Deployment

To deploy the worker to Cloudflare:

```bash
npm run deploy
```

This requires you to be logged in with `wrangler login` or have your API token configured in `~/.wrangler/config.toml`.

## Telegram Bot Setup

1. Create a bot using BotFather (https://t.me/botfather) to get the token
2. The Bot ID is the username of your bot without the @ symbol
3. Hook Secret is a value you create to secure webhook endpoints (https://core.telegram.org/bots/api#setwebhook)
4. Spam Regex is a regular expression pattern used to identify spam messages
