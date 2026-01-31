# OpenClaw Rocket.Chat Channel Plugin

[![npm](https://img.shields.io/npm/v/@cloudrise/openclaw-channel-rocketchat)](https://www.npmjs.com/package/@cloudrise/openclaw-channel-rocketchat)
[![license](https://img.shields.io/npm/l/@cloudrise/openclaw-channel-rocketchat)](LICENSE)

Neutral, self-host friendly Rocket.Chat channel plugin for **OpenClaw** (Cloudrise-maintained).

- **Inbound:** Rocket.Chat Realtime (DDP/WebSocket) subscribe to `stream-room-messages`
- **Outbound:** Rocket.Chat REST `chat.postMessage`

## Upgrade / rename notice

If you were using the old Clawdbot-era package:

- Old: `@cloudrise/clawdbot-channel-rocketchat`
- New: `@cloudrise/openclaw-channel-rocketchat`

## Authors

- Chad (AI assistant running in OpenClaw) — primary implementer
- Marshal Morse — project owner, requirements, infrastructure, and testing

## Quickstart (5–10 minutes)

1) **Create a Rocket.Chat bot user** (or a dedicated user account) and obtain:
   - `userId`
   - `authToken` (treat like a password)

2) **Add the bot user to the rooms** you want it to monitor (channels/private groups). For DMs, ensure users can message the bot.

3) **Install + enable the plugin in OpenClaw**

```yaml
plugins:
  installs:
    rocketchat:
      source: npm
      spec: "@cloudrise/openclaw-channel-rocketchat"
  entries:
    rocketchat:
      enabled: true

channels:
  rocketchat:
    baseUrl: "https://chat.example.com"
    userId: "<ROCKETCHAT_USER_ID>"
    authToken: "<ROCKETCHAT_AUTH_TOKEN>"

    # Optional: keep noise down
    replyMode: auto
    rooms:
      GENERAL:
        requireMention: true
```

4) **Restart the gateway**.

5) **Test** by @mentioning the bot in a room it’s a member of.

---

## Install

### Install from npm

```bash
npm install @cloudrise/openclaw-channel-rocketchat
```

### Configure OpenClaw to load the plugin

You need to tell OpenClaw to load the installed plugin.

**Option A (recommended): install via `plugins.installs` (npm source)**

```yaml
plugins:
  installs:
    rocketchat:
      source: npm
      spec: "@cloudrise/openclaw-channel-rocketchat"
  entries:
    rocketchat:
      enabled: true
```

**Option B: load from a local path**

```yaml
plugins:
  load:
    paths:
      - /absolute/path/to/node_modules/@cloudrise/openclaw-channel-rocketchat
  entries:
    rocketchat:
      enabled: true
```

Then restart the gateway.

## Features

- **Model prefix**: honors `messages.responsePrefix` (e.g. `({model}) `) so replies can include the model name.

## Model switching

There are two parts:

1) **Switching models in chat** (temporary, per-session) via `/model ...`
2) **Defining short aliases** like `qwen3` so you don’t have to type the full `provider/model`

### Switching models in chat (`/model`)

In any chat where OpenClaw slash-commands are enabled, you can switch the current session’s model:

```text
/model
/model list
/model status
/model openai/gpt-5.2
/model qwen3
```

Tip: on Rocket.Chat you’ll often be writing something like:

```text
@Chad /model qwen3
@Chad what do you think about ...
```

### Model aliases (shortcuts like `qwen3`)

OpenClaw supports **model aliases** so you can type a short name (like `qwen3`) instead of a full `provider/model` ref.

**Option A: define aliases in config**

Aliases come from `agents.defaults.models.<modelId>.alias`.

```yaml
agents:
  defaults:
    models:
      "mlx-qwen/mlx-community/qwen3-14b-4bit":
        alias: qwen3
```

**Option B: use the CLI**

```bash
openclaw models aliases add qwen3 mlx-qwen/mlx-community/Qwen3-14B-4bit
openclaw models aliases list
```

Notes:
- Model refs are normalized to lowercase.
- If you define the same alias in config and via CLI, your config value wins.

## Configuration

> Use the room **rid** (e.g. `GENERAL`) for per-room settings.

### Minimal (single account)

```yaml
channels:
  rocketchat:
    baseUrl: "https://chat.example.com"
    userId: "<ROCKETCHAT_USER_ID>"
    authToken: "<ROCKETCHAT_AUTH_TOKEN>"
```

### Multiple accounts / multiple Rocket.Chat servers

You can configure multiple Rocket.Chat “accounts” under `channels.rocketchat.accounts` and choose which one to use via `accountId` when sending.

```yaml
channels:
  rocketchat:
    accounts:
      prod:
        name: "Prod RC"
        baseUrl: "https://chat.example.com"
        userId: "<PROD_USER_ID>"
        authToken: "<PROD_AUTH_TOKEN>"

      staging:
        name: "Staging RC"
        baseUrl: "https://chat-staging.example.com"
        userId: "<STAGING_USER_ID>"
        authToken: "<STAGING_AUTH_TOKEN>"
```

Notes:
- The legacy single-account format (top-level `baseUrl/userId/authToken`) still works and is treated as `accountId: default`.
- Per-room settings live under each account (e.g. `channels.rocketchat.accounts.prod.rooms`).

### Reply routing (thread vs channel)

```yaml
channels:
  rocketchat:
    # thread | channel | auto
    replyMode: auto

    rooms:
      GENERAL:
        requireMention: false
        # Optional per-room override
        # replyMode: channel
```

**Auto rules** (deterministic):
- If the inbound message is already in a thread (`tmid` exists) → reply in that thread
- Else if the inbound message is “long” (≥280 chars or contains a newline) → reply in a thread
- Else → reply in channel

### Per-message overrides

Prefix your message:
- `!thread ...` → force the reply to be posted as a thread reply
- `!channel ...` → force the reply to be posted in the channel

(The prefix is stripped before the message is sent to the agent.)

### Typing indicator

```yaml
channels:
  rocketchat:
    # Delay (ms) before emitting typing indicator
    typingDelayMs: 500
```

(When using multiple accounts, this can also be set per account at `channels.rocketchat.accounts.<accountId>.typingDelayMs`.)

Typing indicators are emitted via DDP `stream-notify-room` using `<RID>/user-activity`.
- Channel replies emit typing without `tmid` → shows under channel composer
- Thread replies include `{ tmid: ... }` → shows under thread composer

## Development

```bash
git clone git@github.com:cloudrise-network/openclaw-channel-rocketchat.git
cd openclaw-channel-rocketchat
npm install
```

Local smoke tests (uses env vars; see `.env.example`):

```bash
# REST send
node test-chad.mjs

# Realtime receive
node test-realtime.mjs
```

## Packaging + publishing (no secrets)

Before publishing:

1) Run a quick secret scan (at minimum):

```bash
grep -RIn --exclude-dir=node_modules --exclude=package-lock.json -E "npm_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|xox[baprs]-|authToken\s*[:=]\s*\"" .
```

2) Bump version in `package.json`.

3) Verify the tarball:

```bash
npm pack
```

4) Publish:

```bash
npm publish
```

(There is also a GitHub Actions workflow in `.github/workflows/publish.yml`.)

## Security

Treat Rocket.Chat `authToken` like a password.

This repository is intended to be publishable (no secrets committed).

## License

MIT
