# Changelog

## [0.4.1] - 2026-02-15

### Fixed

- **Approver bypass**: Approvers are now correctly allowed through the DM access gate to send approval commands. Previously, approvers would get stuck in the "pending approval" flow when DMing the bot.

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
