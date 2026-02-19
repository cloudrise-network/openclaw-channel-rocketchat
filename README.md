# OpenClaw Rocket.Chat Channel Plugin

[![npm](https://img.shields.io/npm/v/@cloudrise/openclaw-channel-rocketchat)](https://www.npmjs.com/package/@cloudrise/openclaw-channel-rocketchat)
[![license](https://img.shields.io/npm/l/@cloudrise/openclaw-channel-rocketchat)](LICENSE)

Neutral, self-host friendly Rocket.Chat channel plugin for **OpenClaw** (Cloudrise-maintained).

- **Inbound:** Rocket.Chat Realtime (DDP/WebSocket) subscribe to `stream-room-messages`
- **Outbound:** Rocket.Chat REST `chat.postMessage`

> **Note:** OpenClaw uses JSON configuration (`~/.openclaw/openclaw.json`). All examples below use JSON format.

## Upgrade notices

### v0.3.0 - DM pairing support

Added support for OpenClaw's DM pairing flow. Default behavior unchanged (`dmPolicy: "open"`), but you can now enable `dmPolicy: "pairing"` for per-user approval.

### v0.2.0+ - plugin id change

The plugin id changed from `rocketchat` to `openclaw-channel-rocketchat` to align with OpenClaw's package-derived id convention and eliminate the "plugin id mismatch" warning.

**Update your config** (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "entries": {
      "openclaw-channel-rocketchat": {
        "enabled": true
      }
    }
  },
  "channels": {
    "rocketchat": {
      "...": "stays the same (channel id ≠ plugin id)"
    }
  }
}
```

### Clawdbot → OpenClaw migration

If you were using the old Clawdbot-era package:

- Old: `@cloudrise/clawdbot-channel-rocketchat`
- New: `@cloudrise/openclaw-channel-rocketchat`

## Authors

- Chad (AI assistant running in OpenClaw) - primary implementer
- Marshal Morse - project owner, requirements, infrastructure, and testing

## Quickstart (5-10 minutes)

1) **Create a Rocket.Chat bot user** (or a dedicated user account) and obtain:
   - `userId`
   - `authToken` (treat like a password)

2) **Add the bot user to the rooms** you want it to monitor (channels/private groups). For DMs, ensure users can message the bot.

3) **Install + enable the plugin in OpenClaw** (`~/.openclaw/openclaw.json`)

```json
{
  "plugins": {
    "installs": {
      "rocketchat": {
        "source": "npm",
        "spec": "@cloudrise/openclaw-channel-rocketchat"
      }
    },
    "entries": {
      "openclaw-channel-rocketchat": {
        "enabled": true
      }
    }
  },
  "channels": {
    "rocketchat": {
      "baseUrl": "https://chat.example.com",
      "userId": "<ROCKETCHAT_USER_ID>",
      "authToken": "<ROCKETCHAT_AUTH_TOKEN>",
      "replyMode": "auto",
      "rooms": {
        "GENERAL": {
          "requireMention": true
        }
      }
    }
  }
}
```

4) **Restart the gateway**.

5) **Test** by @mentioning the bot in a room it's a member of.

### Example chat commands (reply to a room + model switching)

In Rocket.Chat you can send a normal message, or you can switch the session's model first.

**Switch model, then ask a question**:

Rocket.Chat treats messages starting with `/` as Rocket.Chat slash-commands.
So for model switching, either:

- put the directive *after* an @mention (works on most servers/clients), or
- use the plugin's alternate `--model` / `--<alias>` syntax.

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
(mlx-qwen/mlx-community/Qwen3-14B-4bit) Here's a 5-line summary...
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

```json
{
  "plugins": {
    "installs": {
      "rocketchat": {
        "source": "npm",
        "spec": "@cloudrise/openclaw-channel-rocketchat"
      }
    },
    "entries": {
      "openclaw-channel-rocketchat": {
        "enabled": true
      }
    }
  }
}
```

**Option B: load from a local path**

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/absolute/path/to/node_modules/@cloudrise/openclaw-channel-rocketchat"
      ]
    },
    "entries": {
      "openclaw-channel-rocketchat": {
        "enabled": true
      }
    }
  }
}
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
2) **Defining short aliases** like `qwen3` so you don't have to type the full `provider/model`

### Switching models in chat (`/model`)

In any chat where OpenClaw slash-commands are enabled, you can switch the current session's model:

```text
/model
/model list
/model status
/model openai/gpt-5.2
/model qwen3
```

Tip: on Rocket.Chat you'll often be writing something like:

```text
@Chad /model qwen3
@Chad what do you think about ...
```

### Model aliases (shortcuts like `qwen3`)

OpenClaw supports **model aliases** so you can type a short name (like `qwen3`) instead of a full `provider/model` ref.

**Option A: define aliases in config**

Aliases come from `agents.defaults.models.<modelId>.alias`.

```json
{
  "agents": {
    "defaults": {
      "models": {
        "mlx-qwen/mlx-community/qwen3-14b-4bit": {
          "alias": "qwen3"
        }
      }
    }
  }
}
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

```json
{
  "channels": {
    "rocketchat": {
      "baseUrl": "https://chat.example.com",
      "userId": "<ROCKETCHAT_USER_ID>",
      "authToken": "<ROCKETCHAT_AUTH_TOKEN>"
    }
  }
}
```

### Multiple accounts / multiple Rocket.Chat servers

You can configure multiple Rocket.Chat "accounts" under `channels.rocketchat.accounts` and choose which one to use via `accountId` when sending.

```json
{
  "channels": {
    "rocketchat": {
      "accounts": {
        "prod": {
          "name": "Prod RC",
          "baseUrl": "https://chat.example.com",
          "userId": "<PROD_USER_ID>",
          "authToken": "<PROD_AUTH_TOKEN>"
        },
        "staging": {
          "name": "Staging RC",
          "baseUrl": "https://chat-staging.example.com",
          "userId": "<STAGING_USER_ID>",
          "authToken": "<STAGING_AUTH_TOKEN>"
        }
      }
    }
  }
}
```

Notes:
- The legacy single-account format (top-level `baseUrl/userId/authToken`) still works and is treated as `accountId: default`.
- Per-room settings live under each account (e.g. `channels.rocketchat.accounts.prod.rooms`).

### Reply routing (thread vs channel)

```json
{
  "channels": {
    "rocketchat": {
      "replyMode": "auto",
      "rooms": {
        "GENERAL": {
          "requireMention": false,
          "replyMode": "channel"
        }
      }
    }
  }
}
```

Options for `replyMode`: `"thread"` | `"channel"` | `"auto"`

**Auto rules** (deterministic):
- If the inbound message is already in a thread (`tmid` exists) → reply in that thread
- Else if the inbound message is "long" (≥280 chars or contains a newline) → reply in a thread
- Else → reply in channel

### Per-message overrides

Prefix your message:
- `!thread ...` → force the reply to be posted as a thread reply
- `!channel ...` → force the reply to be posted in the channel

(The prefix is stripped before the message is sent to the agent.)

### Typing indicator

```json
{
  "channels": {
    "rocketchat": {
      "typingDelayMs": 500
    }
  }
}
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

```json
{
  "channels": {
    "rocketchat": {
      "dmPolicy": "owner-approval"
    }
  }
}
```

Options: `"open"` | `"owner-approval"` | `"pairing"` | `"allowlist"` | `"disabled"`

| Policy | Behavior |
|--------|----------|
| `open` | **(Default)** All DMs allowed. Rocket.Chat server-level auth is the only gate. |
| `owner-approval` | **🆕** Unknown senders trigger approval request to owner channel. No CLI needed! |
| `pairing` | Unknown senders get a pairing code. Owner approves via CLI. |
| `allowlist` | Only users in `allowFrom` can DM. Others are silently blocked. |
| `disabled` | All DMs blocked. |

---

### Owner Channel Approval (Recommended)

Approve or deny users **directly in Rocket.Chat** - no CLI needed!

```json
{
  "channels": {
    "rocketchat": {
      "dmPolicy": "owner-approval",
      "ownerApproval": {
        "enabled": true,
        "notifyChannels": [
          "@admin",
          "room:APPROVERS"
        ],
        "approvers": [
          "@marshal",
          "role:admin",
          "role:moderator"
        ],
        "notifyOnApprove": true,
        "notifyOnDeny": true,
        "timeout": 3600,
        "onTimeout": "pending"
      }
    }
  }
}
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

```json
{
  "channels": {
    "rocketchat": {
      "groupPolicy": "owner-approval"
    }
  }
}
```

Options: `"open"` | `"owner-approval"` | `"allowlist"` | `"disabled"`

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

**Approvers and notify channels are automatically allowed through access gates** - no manual pre-approval needed!

| `ownerApproval` Entry | DM Gate | Channel/Group Gate |
|-----------------------|---------|-------------------|
| `approvers: ["@user"]` | ✅ Auto-allowed | ✅ Auto-allowed (in any room) |
| `notifyChannels: ["room:ID"]` | N/A | ✅ Auto-allowed |

**Minimal recommended config (no lockout risk):**

```json
{
  "channels": {
    "rocketchat": {
      "dmPolicy": "owner-approval",
      "groupPolicy": "owner-approval",
      "ownerApproval": {
        "enabled": true,
        "approvers": ["@yourusername"],
        "notifyChannels": ["room:YOUR_MAIN_ROOM_ID"],
        "notifyOnApprove": true,
        "notifyOnDeny": true
      }
    }
  }
}
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
```json
{
  "channels": {
    "rocketchat": {
      "allowFrom": ["@alice", "@bob"],
      "groupAllowFrom": ["room:GENERAL", "#support"]
    }
  }
}
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

```json
{
  "channels": {
    "rocketchat": {
      "rooms": {
        "GENERAL": {
          "responseMode": "mention-only",
          "canInteract": ["@alice", "@bob", "role:admin", "role:moderator"],
          "roomApprovers": ["role:owner", "role:moderator", "@marshal"],
          "onMentionUnauthorized": "ignore"
        },
        "SUPPORT": {
          "responseMode": "always"
        }
      }
    }
  }
}
```

Options for `responseMode`: `"mention-only"` | `"always"` (default)
Options for `onMentionUnauthorized`: `"ignore"` | `"reply"`

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
   - Check `responseMode` - respond always or only when @mentioned

**Storage:** `~/.openclaw/credentials/rocketchat-room-users.json`

**Note:** Global approvers (`ownerApproval.approvers`) can interact in ANY room, regardless of per-room settings.

---

### CLI-Based Pairing

If you prefer CLI-based approval:

```json
{
  "channels": {
    "rocketchat": {
      "dmPolicy": "pairing",
      "allowFrom": ["@admin"]
    }
  }
}
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

## Troubleshooting (Upgrades from Early Versions)

If you're upgrading from Clawdbot or early OpenClaw versions, here are common issues:

### Plugin ID Mismatch / Duplicate Plugin Warning

**Symptom:** `plugin msteams: duplicate plugin id detected` or similar warnings.

**Cause:** The plugin ID changed from `rocketchat` to `openclaw-channel-rocketchat` in v0.2.0+.

**Fix:** Update your config to use the new plugin ID:

```json
{
  "plugins": {
    "entries": {
      "openclaw-channel-rocketchat": {
        "enabled": true
      }
    }
  }
}
```

### Broken Symlinks in Extensions

**Symptom:** Plugin fails to load, errors about missing files.

**Cause:** Old installs may have symlinks pointing to `.clawdbot/` paths that no longer exist.

**Fix:** Check for and remove broken symlinks:

```bash
# Check for broken symlinks
ls -la ~/.openclaw/extensions/

# Remove broken symlink
rm ~/.openclaw/extensions/rocketchat  # if it's a broken symlink

# Reinstall the plugin
openclaw doctor --fix
# or manually:
npm pack @cloudrise/openclaw-channel-rocketchat
tar -xzf cloudrise-openclaw-channel-rocketchat-*.tgz
mv package ~/.openclaw/extensions/openclaw-channel-rocketchat
```

### Config File Location Changed

**Symptom:** Config changes don't take effect.

**Cause:** OpenClaw uses `~/.openclaw/openclaw.json` (JSON), not `config.yaml`.

**Fix:** 
- Edit `~/.openclaw/openclaw.json` (not `config.yaml`)
- Ensure valid JSON syntax (use `jq . ~/.openclaw/openclaw.json` to validate)
- Restart gateway: `openclaw gateway restart`

### Sessions Using Wrong Model After Config Change

**Symptom:** Bot replies show old model in `({model})` prefix even after changing config.

**Cause:** Sessions cache the model they were created with.

**Fix:** Clear session model cache:

```bash
# View current sessions
cat ~/.openclaw/agents/main/sessions/sessions.json | jq 'to_entries[] | {key: .key, model: .value.model}'

# Clear all session model overrides
node -e "
const fs = require('fs');
const path = process.env.HOME + '/.openclaw/agents/main/sessions/sessions.json';
const sessions = JSON.parse(fs.readFileSync(path, 'utf8'));
for (const key of Object.keys(sessions)) {
  delete sessions[key].model;
}
fs.writeFileSync(path, JSON.stringify(sessions, null, 2));
console.log('Cleared model overrides from all sessions');
"

# Restart gateway
openclaw gateway restart
```

### Old Gateway Process Still Running

**Symptom:** Config changes don't take effect, or "port already in use" errors.

**Cause:** An old gateway process is still running.

**Fix:**

```bash
# Check for running gateway processes
pgrep -f 'openclaw.*gateway'

# Kill all gateway processes
pkill -f 'openclaw.*gateway'

# Start fresh
openclaw gateway start
```

### Auth Token Invalid After Migration

**Symptom:** `auto-restart attempt X/10` in logs, channel shows "configured" but doesn't connect.

**Cause:** Rocket.Chat auth tokens may have expired or been revoked.

**Fix:** Generate a new personal access token in Rocket.Chat:
1. Log in to Rocket.Chat as the bot user
2. Go to **My Account → Personal Access Tokens**
3. Generate a new token
4. Update `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "rocketchat": {
      "authToken": "<NEW_TOKEN>"
    }
  }
}
```

### nvm / Node Version Issues (macOS)

**Symptom:** `openclaw` command not found, or wrong Node version.

**Cause:** nvm doesn't automatically load in non-interactive shells.

**Fix:** Source nvm before running openclaw:

```bash
source ~/.nvm/nvm.sh && nvm use 22 && openclaw gateway restart
```

Or add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

### Backup Files (.bak) Causing Confusion

**Symptom:** Unsure which config is active.

**Cause:** OpenClaw creates `.bak` files when configs change.

**Fix:** The active config is always `~/.openclaw/openclaw.json`. Backup files (`.bak`, `.bak.1`, etc.) are for recovery only:

```bash
# List all config files
ls -la ~/.openclaw/*.json*

# View active config
cat ~/.openclaw/openclaw.json | jq .
```

## Security

Treat Rocket.Chat `authToken` like a password.

This repository is intended to be publishable (no secrets committed).

## License

MIT