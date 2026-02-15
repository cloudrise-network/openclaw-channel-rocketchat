# Changelog

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
