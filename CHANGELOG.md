# Changelog

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
