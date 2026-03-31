/**
 * Guard against duplicate buffered deliveries for the same inbound turn.
 *
 * Some runtimes can emit the exact same final text more than once when a
 * session is resuming or finalizing. For Rocket.Chat we treat identical
 * consecutive payloads in the same reply cycle as duplicates and suppress them.
 */

export function createRocketChatReplyDeduper() {
  let lastText = null;

  return {
    shouldDeliver(text) {
      const normalized = String(text ?? "").trim();
      if (!normalized) return false;
      if (normalized === lastText) return false;
      lastText = normalized;
      return true;
    },
  };
}
