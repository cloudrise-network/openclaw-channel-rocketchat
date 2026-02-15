# Changelog

## [0.6.0] - 2026-02-15

> ⚠️ **Beta Features**: The approval flows (owner-approval, per-room ACL) in 0.5.0+ are functional but should be considered beta. Additional testing recommended before production use.

### Added

- **Per-Room User Access Control**: Fine-grained control over who can interact with the bot in each room
  - `rooms.<roomId>.canInteract` — static list of users/roles who can interact
  - `rooms.<roomId>.roomApprovers` — who can approve others for this room
  - `rooms.<roomId>.responseMode` — "always" or "mention-only" for approved users
  - `rooms.<roomId>.onMentionUnauthorized` — "ignore" or "reply" when unauthorized user @mentions bot
- **Room-level commands** for roomApprovers:
  - `room-approve @user` — approve user for current room only
  - `room-deny @user` — remove user from room's approved list
  - `room-list` — list approved users for current room
- **Dynamic room user storage**: `~/.openclaw/credentials/rocketchat-room-users.json`

### Example Config

```yaml
rooms:
  GENERAL:
    responseMode: "mention-only"   # Only respond when @mentioned
    canInteract:                   # Static approved users
      - "role:admin"
      - "@marshal"
    roomApprovers:                 # Who can approve others
      - "role:owner"
      - "role:moderator"
    onMentionUnauthorized: "ignore"
```

## [0.5.0] - 2026-02-15

### Added

- **Channel/Room Approval**: New `groupPolicy: "owner-approval"` for controlling which channels the bot responds in
  - Bot sends "pending approval" message on first message in unapproved channels
  - Approve with `approve room:ROOMID`, deny with `deny room:ROOMID`
  - Separate allowlist for rooms (`groupAllowFrom` config or `rocketchat-rooms-allowFrom.json`)
- **Bootstrapping documentation**: Clear instructions to pre-approve approvers and main channels to avoid lockout

### Fixed

- **Approver bypass**: Approvers are now correctly allowed through both DM and group access gates. Previously, approvers would get stuck in the "pending approval" flow.

## [0.4.0] - 2026-02-15

### Added

- **Owner Channel Approval**: New `dmPolicy: "owner-approval"` mode for in-channel approval flow
  - No CLI needed — approve/deny via Rocket.Chat messages
  - Configure `ownerApproval.notifyChannels` for where to receive requests
  - Configure `ownerApproval.approvers` with usernames or Rocket.Chat roles (`role:admin`, `role:moderator`)
  - Commands: `approve @user`, `deny @user`, `approve room:ID`, `pending`
  - Requester gets notified when approved/denied
- **Rocket.Chat Role Integration**: Approvers can be defined by RC roles (admin, moderator, etc.)

### Example Config

```yaml
channels:
  rocketchat:
    dmPolicy: "owner-approval"
    ownerApproval:
      enabled: true
      notifyChannels:
        - "@admin"
        - "room:APPROVERS"
      approvers:
        - "@marshal"
        - "role:admin"
      notifyOnApprove: true
      notifyOnDeny: true
```

## [0.3.0] - 2026-02-15

### Added

- **DM Pairing support**: Implements OpenClaw's standard pairing flow for DM access control
  - `dmPolicy: "pairing"` - unknown senders get a code, owner approves via `openclaw pairing approve rocketchat <code>`
  - `dmPolicy: "allowlist"` - only pre-configured `allowFrom` users can DM
  - `dmPolicy: "disabled"` - block all DMs
  - `dmPolicy: "open"` (default) - all DMs allowed (Rocket.Chat server auth is the gate)
- **Pairing notifications**: When a user is approved, they receive a confirmation message
- **Full config schema**: Added JSON Schema validation for all config options

### Changed

- `pairing.idLabel` now shows "Rocket.Chat User ID" in CLI output
- Improved logging for pairing requests and access control decisions

## [0.2.0] - 2026-02-15

### ⚠️ Breaking Changes

- **Plugin id changed** from `rocketchat` to `openclaw-channel-rocketchat` to align with OpenClaw's package-derived id convention and fix the "plugin id mismatch" warning spam ([#1](https://github.com/cloudrise-network/openclaw-channel-rocketchat/issues/1))

  **Required config update:**
  ```yaml
  plugins:
    entries:
      openclaw-channel-rocketchat:  # ← was "rocketchat"
        enabled: true
  
  channels:
    rocketchat:  # ← stays the same
      ...
  ```

## [0.1.16] - 2026-02-08

- DM delivery fix: subscribe to all rooms including DMs (removed `open !== false` filter)
- Various stability improvements

## [0.1.0] - 2026-01-31

- Initial OpenClaw release (ported from @cloudrise/clawdbot-channel-rocketchat)
