# Discord -> Stoat Server Migration

Copies a Discord server (channels, categories, and optionally messages) to a new Stoat server.

## Setup

```bash
cp .env.example .env
# Edit .env with your tokens
npm install
```

## Usage

```bash
# Structure only (channels + categories):
DISCORD_TOKEN=xxx STOAT_TOKEN=xxx DISCORD_SERVER_ID=xxx node index.js

# Structure + last 50 messages per channel:
DISCORD_TOKEN=xxx STOAT_TOKEN=xxx DISCORD_SERVER_ID=xxx MESSAGE_LIMIT=50 node index.js
```

## Tokens

- **DISCORD_TOKEN**: Bot token from https://discord.com/developers/applications
  - Needs `bot` scope with `Send Messages`, `Read Message History`, `View Channels`
- **STOAT_TOKEN**: Bot token. Create a bot at `https://stoat.chat/settings/bots` then copy the token.

## What it copies

- Server name & description
- Text channels (normal + announcement)
- Voice channels (normal + stage)
- Forum channels (as text channels)
- Channel categories
- NSFW flag
- Channel topics
- Messages (optional, with rate limiting)
