/**
 * Rocket.Chat ACP session binding registration and storage.
 */

const DEFAULT_ACCOUNT_ID = "default";
const BINDING_ID_PREFIX = "rocketchat-binding";

const globalState = (() => {
  if (!globalThis.__openclawRocketChatSessionBindings) {
    globalThis.__openclawRocketChatSessionBindings = {
      managersByAccountId: new Map(),
    };
  }
  return globalThis.__openclawRocketChatSessionBindings;
})();

function normalizeAccountId(accountId) {
  return typeof accountId === "string" && accountId.trim()
    ? accountId.trim()
    : DEFAULT_ACCOUNT_ID;
}

function buildBindingKey({ accountId, conversationId }) {
  return `${accountId}:${conversationId}`;
}

function buildBindingId({ accountId, conversationId }) {
  return `${BINDING_ID_PREFIX}:${encodeURIComponent(accountId)}:${encodeURIComponent(conversationId)}`;
}

function parseBindingId(bindingId) {
  if (typeof bindingId !== "string") return null;
  const trimmed = bindingId.trim();
  if (!trimmed.startsWith(`${BINDING_ID_PREFIX}:`)) return null;
  const [, encodedAccountId = "", ...rest] = trimmed.split(":");
  if (!encodedAccountId || rest.length === 0) return null;

  return {
    accountId: decodeURIComponent(encodedAccountId),
    conversationId: decodeURIComponent(rest.join(":")),
  };
}

function resolveTargetKind(targetKind) {
  return targetKind === "subagent" ? "subagent" : "session";
}

function resolveAgentIdFromSessionKey(targetSessionKey) {
  const trimmed = typeof targetSessionKey === "string" ? targetSessionKey.trim() : "";
  if (!trimmed) return undefined;
  const firstSegment = trimmed.split(":", 1)[0]?.trim();
  return firstSegment || undefined;
}

function resolveExpiresAt(record, defaults) {
  const candidates = [];
  if (typeof defaults.idleTimeoutMs === "number" && defaults.idleTimeoutMs > 0) {
    candidates.push(record.lastActivityAt + defaults.idleTimeoutMs);
  }
  if (typeof defaults.maxAgeMs === "number" && defaults.maxAgeMs > 0) {
    candidates.push(record.boundAt + defaults.maxAgeMs);
  }
  if (candidates.length === 0) return undefined;
  return Math.min(...candidates);
}

function toSessionBindingRecord(record, defaults) {
  return {
    bindingId: buildBindingId({
      accountId: record.accountId,
      conversationId: record.conversationId,
    }),
    targetSessionKey: record.targetSessionKey,
    targetKind: record.targetKind,
    conversation: {
      channel: "rocketchat",
      accountId: record.accountId,
      conversationId: record.conversationId,
      ...(record.parentConversationId
        ? { parentConversationId: record.parentConversationId }
        : {}),
    },
    status: "active",
    boundAt: record.boundAt,
    ...(resolveExpiresAt(record, defaults) != null
      ? { expiresAt: resolveExpiresAt(record, defaults) }
      : {}),
    metadata: {
      agentId: record.agentId,
      label: record.label,
      boundBy: record.boundBy,
      lastActivityAt: record.lastActivityAt,
      idleTimeoutMs: defaults.idleTimeoutMs,
      maxAgeMs: defaults.maxAgeMs,
      parentConversationId: record.parentConversationId,
    },
  };
}

export function createRocketChatSessionBindingManager(params) {
  const accountId = normalizeAccountId(params?.accountId);
  const existing = globalState.managersByAccountId.get(accountId);
  if (existing) return existing;

  const defaults = {
    idleTimeoutMs: params?.idleTimeoutMs ?? 0,
    maxAgeMs: params?.maxAgeMs ?? 0,
  };
  const bindingsByConversation = new Map();
  let sessionBindingAdapter = null;

  const manager = {
    accountId,
    getByConversationId(conversationId) {
      const normalizedConversationId =
        typeof conversationId === "string" ? conversationId.trim() : "";
      if (!normalizedConversationId) return undefined;
      return bindingsByConversation.get(
        buildBindingKey({
          accountId,
          conversationId: normalizedConversationId,
        })
      );
    },
    listBySessionKey(targetSessionKey) {
      const normalizedTargetSessionKey =
        typeof targetSessionKey === "string" ? targetSessionKey.trim() : "";
      if (!normalizedTargetSessionKey) return [];
      return [...bindingsByConversation.values()].filter(
        (record) => record.targetSessionKey === normalizedTargetSessionKey
      );
    },
    bindConversation({ conversationId, parentConversationId, targetKind, targetSessionKey, metadata }) {
      const normalizedConversationId =
        typeof conversationId === "string" ? conversationId.trim() : "";
      const normalizedTargetSessionKey =
        typeof targetSessionKey === "string" ? targetSessionKey.trim() : "";
      if (!normalizedConversationId || !normalizedTargetSessionKey) return null;

      const now = Date.now();
      const record = {
        accountId,
        conversationId: normalizedConversationId,
        ...(typeof parentConversationId === "string" && parentConversationId.trim()
          ? { parentConversationId: parentConversationId.trim() }
          : {}),
        targetKind: resolveTargetKind(targetKind),
        targetSessionKey: normalizedTargetSessionKey,
        agentId:
          typeof metadata?.agentId === "string" && metadata.agentId.trim()
            ? metadata.agentId.trim()
            : resolveAgentIdFromSessionKey(normalizedTargetSessionKey),
        label:
          typeof metadata?.label === "string" && metadata.label.trim()
            ? metadata.label.trim()
            : undefined,
        boundBy:
          typeof metadata?.boundBy === "string" && metadata.boundBy.trim()
            ? metadata.boundBy.trim()
            : undefined,
        boundAt: now,
        lastActivityAt: now,
      };

      bindingsByConversation.set(
        buildBindingKey({
          accountId,
          conversationId: normalizedConversationId,
        }),
        record
      );
      return record;
    },
    touchConversation(conversationId, at = Date.now()) {
      const existingRecord = manager.getByConversationId(conversationId);
      if (!existingRecord) return null;
      const updated = {
        ...existingRecord,
        lastActivityAt: at,
      };
      bindingsByConversation.set(
        buildBindingKey({
          accountId,
          conversationId: updated.conversationId,
        }),
        updated
      );
      return updated;
    },
    unbindConversation(conversationId) {
      const existingRecord = manager.getByConversationId(conversationId);
      if (!existingRecord) return null;
      bindingsByConversation.delete(
        buildBindingKey({
          accountId,
          conversationId: existingRecord.conversationId,
        })
      );
      return existingRecord;
    },
    unbindBySessionKey(targetSessionKey) {
      const removed = [];
      for (const record of manager.listBySessionKey(targetSessionKey)) {
        bindingsByConversation.delete(
          buildBindingKey({
            accountId,
            conversationId: record.conversationId,
          })
        );
        removed.push(record);
      }
      return removed;
    },
    stop() {
      bindingsByConversation.clear();
      globalState.managersByAccountId.delete(accountId);
      if (sessionBindingAdapter && typeof params?.unregisterSessionBindingAdapter === "function") {
        params.unregisterSessionBindingAdapter({
          channel: "rocketchat",
          accountId,
          adapter: sessionBindingAdapter,
        });
      }
    },
  };

  sessionBindingAdapter = {
    channel: "rocketchat",
    accountId,
    capabilities: { placements: ["current"] },
    bind: async (input) => {
      if (input.conversation.channel !== "rocketchat" || input.placement === "child") {
        return null;
      }
      const bound = manager.bindConversation({
        conversationId: input.conversation.conversationId,
        parentConversationId: input.conversation.parentConversationId,
        targetKind: input.targetKind,
        targetSessionKey: input.targetSessionKey,
        metadata: input.metadata,
      });
      return bound ? toSessionBindingRecord(bound, defaults) : null;
    },
    listBySession: (targetSessionKey) =>
      manager.listBySessionKey(targetSessionKey).map((entry) =>
        toSessionBindingRecord(entry, defaults)
      ),
    resolveByConversation: (ref) => {
      if (ref.channel !== "rocketchat") return null;
      const found = manager.getByConversationId(ref.conversationId);
      return found ? toSessionBindingRecord(found, defaults) : null;
    },
    touch: (bindingId, at) => {
      const parsed = parseBindingId(bindingId);
      if (!parsed || parsed.accountId !== accountId) return;
      manager.touchConversation(parsed.conversationId, at);
    },
    unbind: async (input) => {
      if (input.targetSessionKey?.trim()) {
        return manager.unbindBySessionKey(input.targetSessionKey.trim()).map((entry) =>
          toSessionBindingRecord(entry, defaults)
        );
      }

      const parsed = parseBindingId(input.bindingId);
      if (!parsed || parsed.accountId !== accountId) return [];

      const removed = manager.unbindConversation(parsed.conversationId);
      return removed ? [toSessionBindingRecord(removed, defaults)] : [];
    },
  };

  if (typeof params?.registerSessionBindingAdapter === "function") {
    params.registerSessionBindingAdapter(sessionBindingAdapter);
  }

  globalState.managersByAccountId.set(accountId, manager);
  return manager;
}

export function ensureRocketChatSessionBindings(params) {
  const accountIds = new Set(
    typeof params.listAccountIds === "function" ? params.listAccountIds(params.cfg) : []
  );
  accountIds.add(DEFAULT_ACCOUNT_ID);

  for (const accountId of accountIds) {
    createRocketChatSessionBindingManager({
      accountId,
      idleTimeoutMs: params.resolveIdleTimeoutMs?.({ cfg: params.cfg, channel: "rocketchat", accountId }) ?? 0,
      maxAgeMs: params.resolveMaxAgeMs?.({ cfg: params.cfg, channel: "rocketchat", accountId }) ?? 0,
      registerSessionBindingAdapter: params.registerSessionBindingAdapter,
      unregisterSessionBindingAdapter: params.unregisterSessionBindingAdapter,
    });
  }

  for (const [accountId, manager] of globalState.managersByAccountId.entries()) {
    if (accountIds.has(accountId)) continue;
    manager.stop();
  }
}

export function getRocketChatSessionBindingManager(accountId) {
  return globalState.managersByAccountId.get(normalizeAccountId(accountId)) ?? null;
}

export const __testing = {
  parseBindingId,
  resetRocketChatSessionBindingsForTests() {
    for (const manager of globalState.managersByAccountId.values()) {
      manager.stop();
    }
    globalState.managersByAccountId.clear();
  },
};
