# DX Mute Bot

A Telegram group moderation bot built with TypeScript, Cloudflare Workers, and Cloudflare D1.
Host your own instance to filter spam, let members vote on temporary mutes, and clean up failed
join verifications. The included message templates are in Cantonese and can be customized.

## Features

- **Spam filtering:** Ban users whose display names or messages match a configurable regular expression.
- **Community mute votes:** Reply to a message with `/silence` to open a vote. The bot updates the
  member's mute status as votes change and shows who voted against the proposal.
- **Verification cleanup:** Remove join notices and matched Rose welcome messages after a newcomer
  leaves or is removed. During quiet periods, additional names are added to one announcement.
- **Reaction moderation:** Ban users who react to group messages after leaving or being removed.
- **Custom titles:** Group administrators can reply with `/customtitle <title>` to assign a member
  an administrator title. This promotes the member with permission to invite users.

With the included settings, mute polls run for 24 hours. At least three non-abstaining votes and
70% support are required for a mute, which expires 72 hours after the poll was created.

## Requirements

- Node.js 22.13 or newer and npm.
- A Cloudflare account with Workers and D1 available.
- A Telegram bot created through [BotFather](https://t.me/BotFather).
- Administrator access to the Telegram group. Give the bot permission to delete messages and
  ban/restrict members, plus permission to promote members if using custom titles.
- Rose configured for captcha verification if using the verification cleanup feature.

## Setup

Run the following commands from your local copy of this repository.

### 1. Install dependencies and sign in

```bash
npm ci
npx wrangler login
```

### 2. Configure your instance

Edit [wrangler.toml](wrangler.toml). Replace the Worker `name` and the bot and chat usernames with
your own, and review the spam pattern, poll settings, and message templates for your community.
The settings below belong in the existing `[vars]` section; keep the other variables in that section.

```toml
TG_BOT_USERNAME = "YourBotUsername"
TG_ALLOWED_CHAT_USERNAMES = "YourGroupUsername"
TG_BOT_TIMEZONE = "Asia/Hong_Kong"
```

| Setting                     | Purpose                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TG_BOT_USERNAME`           | Your bot's username, without `@`.                                                                                 |
| `TG_ALLOWED_CHAT_USERNAMES` | Comma-separated chat usernames, without `@` or spaces. The username filter applies to chats that have a username. |
| `TG_BOT_TIMEZONE`           | Timezone used in poll status messages.                                                                            |
| `TG_SPAM_RE`                | Regular expression matched against display names and message text. Matches trigger bans.                          |
| `TG_SILENCE_CONSENSUS_*`    | Mute command, voting thresholds, durations, poll options, and message templates.                                  |
| `TG_ROSE_*`                 | Rose's username, welcome prefix, cleanup timing, and announcement template.                                       |

Durations are in seconds. Poll options must remain in this order: support, oppose, abstain.

### 3. Create the database

```bash
npx wrangler d1 create tg-bot-d1
```

Copy the returned database name and ID into the existing `[[d1_databases]]` entry in
`wrangler.toml`, keeping `binding = "DB"`. If you choose a different database name, use it in
the commands below too.

Initialize the **new database**:

```bash
npx wrangler d1 execute tg-bot-d1 --remote --file=./schema/schema.sql
```

The full schema recreates `silence_poll`. For an existing installation, use the
[upgrade instructions](#updating-an-existing-deployment) instead.

### 4. Set secrets and deploy

```bash
npx wrangler secret put TG_BOT_TOKEN
npx wrangler secret put TG_HOOK_SECRET
npm run deploy
```

Use the bot token from BotFather for `TG_BOT_TOKEN`. For `TG_HOOK_SECRET`, choose a random value
using letters, digits, underscores, or hyphens, and keep it for the webhook registration below.
Store both values as secrets rather than putting them in `wrangler.toml`.

Deployment prints your Worker's HTTPS URL and registers the schedule in `wrangler.toml`.
The included schedule runs verification cleanup and closes expired polls once per minute.

### 5. Connect Telegram

Add the bot to your group with the permissions listed above. In your shell, set `TG_BOT_TOKEN`
and `TG_HOOK_SECRET` to the same values you supplied to Wrangler, and set `WORKER_URL` to the
HTTPS URL printed during deployment. Register the webhook:

```bash
curl --request POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WORKER_URL}" \
  --data-urlencode "secret_token=${TG_HOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","channel_post","message_reaction","poll","poll_answer"]'
```

The secret must match `TG_HOOK_SECRET` so the Worker accepts incoming updates. The explicit
update list enables the messages, reactions, and poll events used by the bot. See Telegram's
[webhook documentation](https://core.telegram.org/bots/api#setwebhook) for the API parameters.

## Rose verification cleanup

Configure `TG_ROSE_BOT_USERNAME` and `TG_ROSE_CAPTCHA_WELCOME_PREFIX` to match your Rose setup.
DX Mute Bot checks newcomers' membership status after `TG_ROSE_CAPTCHA_CLEANUP_DELAY` and removes
join notices for users who have left or been removed. When it receives and can match Rose's
welcome message, it removes that message too. Rose handles verification and removal; this bot
handles the follow-up cleanup.

Cleanup announcements combine names in one message while the chat is quiet:

> 「Alice」，「Bob」，「Charlie」驗證都唔撳，九成係騙子。已清理，世界線穩定。

A normal text, media, or bot message received by the Worker starts a new summary. Join/leave
notices and Rose captcha prompts keep the current summary open. Names remain clickable, and
older names are replaced with a count if the message fills up.

Customize `TG_ROSE_CAPTCHA_CLEANUP_ANNOUNCEMENT_TEMPLATE` using `{displayNames}` for the quoted,
comma-separated user links. For example:

```toml
TG_ROSE_CAPTCHA_CLEANUP_ANNOUNCEMENT_TEMPLATE = "Cleaned up failed verification notices for {displayNames}."
```

## Local development

Create a `.dev.vars` file in the project root with your development bot's secrets:

```dotenv
TG_BOT_TOKEN=your-development-bot-token
TG_HOOK_SECRET=your-development-webhook-secret
```

Initialize a fresh local database and start the Worker:

```bash
npx wrangler d1 execute tg-bot-d1 --local --file=./schema/schema.sql
npm run dev
```

To receive live Telegram updates locally, expose the development server through an HTTPS tunnel
and register that URL as the development bot's webhook.

Run the checks:

```bash
npm test
npm run build
```

Tests use an in-memory SQLite database and mocked Telegram responses. The build generates
Cloudflare types and runs the TypeScript compiler.

## Updating an existing deployment

Apply the additive schema files to bring an older database up to date, then deploy:

```bash
npx wrangler d1 execute tg-bot-d1 --remote --file=./schema/pending_join_cleanup.sql
npx wrangler d1 execute tg-bot-d1 --remote --file=./schema/join_cleanup_announcement.sql
npm run deploy
```

Both scripts can be rerun and preserve existing data. Use `--local` for a local development
database. See the [D1 command reference](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute)
for database execution options.
