# OpenClaw Rocket.Chat Channel Plugin

[![npm](https://img.shields.io/npm/v/@cloudrise/openclaw-channel-rocketchat)](https://www.npmjs.com/package/@cloudrise/openclaw-channel-rocketchat)
[![license](https://img.shields.io/npm/l/@cloudrise/openclaw-channel-rocketchat)](LICENSE)

Neutral, self-host friendly Rocket.Chat channel plugin for **OpenClaw** (Cloudrise-maintained).

- **Inbound:** Rocket.Chat Realtime (DDP/WebSocket) subscribe to `stream-room-messages`
- **Outbound:** Rocket.Chat REST `chat.postMessage`

## Upgrade notices

### v0.3.0 — DM pairing support

Added support for OpenClaw's DM pairing flow. Default behavior unchanged (`dmPolicy: "open"`), but you can now enable `dmPolicy: "pairing"` for per-user approval.

### v0.2.0+ — plugin id change

The plugin id changed from `rocketchat` to `openclaw-channel-rocketchat` to align with OpenClaw's package-derived id convention and eliminate the "plugin id mismatch" warning.

**Update your config:**

```yaml
plugins:
  entries:
    openclaw-channel-rocketchat:  # ← was "rocketchat"
      enabled: true

channels:
  rocketchat:  # ← stays the same (channel id ≠ plugin id)
    ...
```

### Clawdbot → OpenClaw migration

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
    openclaw-channel-rocketchat:
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

### Example chat commands (reply to a room + model switching)

In Rocket.Chat you can send a normal message, or you can switch the session’s model first.

**Switch model, then ask a question**:

Rocket.Chat treats messages starting with `/` as Rocket.Chat slash-commands.
So for model switching, either:

- put the directive *after* an @mention (works on most servers/clients), or
- use the plugin’s alternate `--model` / `--<alias>` syntax.

```text
# Option A: use /model after an @mention
@Chad /model qwen3
@Chad write a 5-line summary of our incident in plain English

# Option B: alternate syntax (avoids Rocket.Chat /commands)
@Chad --model qwen3
@Chad write a 5-line summary of our incident in plain English

# Option C: shorthand alias form
@Chad --qwen3
@Chad write a 5-line summary of our incident in plain English
```

**Example output** (with `messages.responsePrefix: "({model}) "` enabled):

```text
(mlx-qwen/mlx-community/Qwen3-14B-4bit) Here’s a 5-line summary...
...
```

**Send a one-off message to a specific Rocket.Chat room** (from the gateway host):

```bash
openclaw message send --channel rocketchat --to room:GENERAL --message "Hello from OpenClaw"
```

**Send using a specific model for that one message**:

```bash
openclaw message send --channel rocketchat --to room:GENERAL --message "/model qwen3 Hello from Qwen3"
```

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
    openclaw-channel-rocketchat:
      enabled: true
```

**Option B: load from a local path**

```yaml
plugins:
  load:
    paths:
      - /absolute/path/to/node_modules/@cloudrise/openclaw-channel-rocketchat
  entries:
    openclaw-channel-rocketchat:
      enabled: true
```

Then restart the gateway.

## Features

- **Inbound attachments**: receives images, PDFs/documents, and audio; forwards them to OpenClaw for vision/document understanding and transcription.
- **Outbound attachments**: can send local file paths as real Rocket.Chat uploads (inline previews when supported).
- **Reactions**: can react to messages with emoji (via `chat.react`).

- **File attachments**: receives images, PDFs, documents, audio uploaded to Rocket.Chat and passes them to the vision model.
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

## DM Access Control

The plugin supports multiple DM access control modes, including a unique **Owner Channel Approval** flow.

### DM Policies

```yaml
channels:
  rocketchat:
    dmPolicy: "owner-approval"  # or "open" | "pairing" | "allowlist" | "disabled"
```

| Policy | Behavior |
|--------|----------|
| `open` | **(Default)** All DMs allowed. Rocket.Chat server-level auth is the only gate. |
| `owner-approval` | **🆕** Unknown senders trigger approval request to owner channel. No CLI needed! |
| `pairing` | Unknown senders get a pairing code. Owner approves via CLI. |
| `allowlist` | Only users in `allowFrom` can DM. Others are silently blocked. |
| `disabled` | All DMs blocked. |

---

### Owner Channel Approval (Recommended)

Approve or deny users **directly in Rocket.Chat** — no CLI needed!

```yaml
channels:
  rocketchat:
    dmPolicy: "owner-approval"
    ownerApproval:
      enabled: true
      
      # Where to send approval notifications
      notifyChannels:
        - "@admin"            # DM to specific user
        - "room:APPROVERS"    # or a dedicated room
      
      # Who can approve (supports Rocket.Chat roles!)
      approvers:
        - "@marshal"          # specific username
        - "role:admin"        # anyone with RC admin role
        - "role:moderator"    # anyone with moderator role
      
      # Notify requester when decision is made
      notifyOnApprove: true
      notifyOnDeny: true
      
      # Optional timeout (seconds)
      timeout: 3600
      onTimeout: "pending"    # or "deny" or "remind"
```

**Flow:**
1. Unknown user sends a DM
2. Bot notifies owner channel: `"🔔 New DM request from @user123"`
3. Owner replies: `approve @user123` or `deny @user123`
4. Requester gets notified: `"✅ You've been approved!"`
5. Future messages are processed normally

**Commands (in owner channel or DM to bot):**
```
approve @user123           # approve a user
deny @user123              # deny a user
approve room:GENERAL       # approve a room
pending                    # list pending requests
```

---

### Channel/Room Approval (groupPolicy)

Control which channels the bot responds in:

```yaml
channels:
  rocketchat:
    groupPolicy: "owner-approval"  # or "open" | "allowlist" | "disabled"
```

| Policy | Behavior |
|--------|----------|
| `open` | **(Default)** Bot responds in any channel it's added to. |
| `owner-approval` | Bot sends "pending approval" on first message in new channels. |
| `allowlist` | Only channels in `groupAllowFrom` receive responses. |
| `disabled` | Bot ignores all channel messages. |

**With `groupPolicy: "owner-approval"`:**
- When invited to a new channel, first message triggers approval request
- Approvers receive: `"🔔 Bot invited to #channel-name by @user"`
- Approve with: `approve room:ROOMID`

---

### 🔑 Auto-Approval (Important!)

**Approvers and notify channels are automatically allowed through access gates** — no manual pre-approval needed!

| `ownerApproval` Entry | DM Gate | Channel/Group Gate |
|-----------------------|---------|-------------------|
| `approvers: ["@user"]` | ✅ Auto-allowed | ✅ Auto-allowed (in any room) |
| `notifyChannels: ["room:ID"]` | N/A | ✅ Auto-allowed |

**Minimal recommended config (no lockout risk):**

```yaml
channels:
  rocketchat:
    dmPolicy: "owner-approval"
    groupPolicy: "owner-approval"
    
    ownerApproval:
      enabled: true
      approvers:
        - "@yourusername"           # You can DM the bot + approve in any room
      notifyChannels:
        - "room:YOUR_MAIN_ROOM_ID"  # This room is auto-approved
      notifyOnApprove: true
      notifyOnDeny: true
```

That's it! With this config:
- ✅ You can DM the bot (you're an approver)
- ✅ Your main room works (it's a notify channel)
- ✅ Approval commands work in your main room
- 🔒 Everyone else needs approval

---

### Manual Pre-Approval (Optional)

If you need to pre-approve additional users or rooms that aren't approvers/notifyChannels:

**In config:**
```yaml
channels:
  rocketchat:
    allowFrom:           # Pre-approved DM users
      - "@alice"
      - "@bob"
    groupAllowFrom:      # Pre-approved rooms
      - "room:GENERAL"
      - "#support"
```

**Or via files:**
```bash
# Pre-approve DM users
echo '{"version":1,"entries":["alice","bob"]}' > ~/.openclaw/credentials/rocketchat-allowFrom.json

# Pre-approve rooms
echo '{"version":1,"entries":["GENERAL"]}' > ~/.openclaw/credentials/rocketchat-rooms-allowFrom.json
```

---

### Per-Room User Access Control

Control which users can interact with the bot **within each approved room**:

```yaml
channels:
  rocketchat:
    rooms:
      GENERAL:
        # Response mode for approved users
        responseMode: "mention-only"  # or "always" (default)
        
        # Who can interact (static list)
        canInteract:
          - "@alice"
          - "@bob"
          - "role:admin"
          - "role:moderator"
        
        # Who can approve/deny users for THIS room
        roomApprovers:
          - "role:owner"          # Room owners
          - "role:moderator"
          - "@marshal"
        
        # When non-approved user @mentions bot
        onMentionUnauthorized: "ignore"  # or "reply" (sends "not authorized")
      
      SUPPORT:
        # No restrictions - everyone in the room can interact
        responseMode: "always"
```

**Room-level commands** (usable by `roomApprovers`):
```
room-approve @alice     # Approve alice for THIS room only
room-deny @alice        # Remove alice from this room's approved list
room-list               # Show who's approved in this room
```

**How it works:**
1. Room gets global approval (via `groupPolicy`)
2. Per-room user check: is sender in `canInteract`, `roomApprovers`, or dynamically approved?
3. If not approved:
   - Silent ignore (unless `onMentionUnauthorized: "reply"`)
4. If approved:
   - Check `responseMode` — respond always or only when @mentioned

**Storage:** `~/.openclaw/credentials/rocketchat-room-users.json`

**Note:** Global approvers (`ownerApproval.approvers`) can interact in ANY room, regardless of per-room settings.

---

### CLI-Based Pairing

If you prefer CLI-based approval:

```yaml
channels:
  rocketchat:
    dmPolicy: "pairing"
    allowFrom:
      - "@admin"           # pre-approved users
```

**Flow:**
1. Unknown user sends a DM
2. Bot replies with a pairing code: `"Pairing required. Code: ABC12345"`
3. Owner approves via CLI:
   ```bash
   openclaw pairing list rocketchat
   openclaw pairing approve rocketchat ABC12345
   ```
4. User is added to allowlist

---

### Why is the default "open"?

Unlike public platforms (Telegram, WhatsApp, Signal), Rocket.Chat is typically:
- Self-hosted with authenticated users
- Behind organizational access controls
- Already requires user accounts to message

So **server-level authentication acts as the primary gate**. Use `owner-approval` or `pairing` if you need per-user approval on top of that.

## Security

Treat Rocket.Chat `authToken` like a password.

This repository is intended to be publishable (no secrets committed).

## License

MIT