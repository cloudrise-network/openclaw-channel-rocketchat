/**
 * Rocket.Chat ACP conversation binding helpers.
 */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeRocketChatConversationId(target) {
  const trimmed = normalizeText(target);
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("rocketchat:room:")) {
    return trimmed.slice("rocketchat:room:".length).trim();
  }
  if (lower.startsWith("rocketchat:")) {
    return trimmed.slice("rocketchat:".length).trim();
  }
  if (lower.startsWith("room:")) {
    return trimmed.slice("room:".length).trim();
  }

  return trimmed;
}

export function resolveRocketChatCommandConversation(params = {}) {
  const threadId = normalizeText(params.threadId);
  const threadParentId = normalizeRocketChatConversationId(params.threadParentId);
  const baseConversationId =
    normalizeRocketChatConversationId(params.originatingTo) ||
    normalizeRocketChatConversationId(params.commandTo) ||
    normalizeRocketChatConversationId(params.fallbackTo);

  if (threadId) {
    return {
      conversationId: threadId,
      parentConversationId: threadParentId || baseConversationId || undefined,
    };
  }

  if (!baseConversationId) return null;

  return {
    conversationId: baseConversationId,
    parentConversationId: threadParentId || undefined,
  };
}
