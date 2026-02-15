/**
 * Rocket.Chat channel plugin for OpenClaw
 */

import {
  DEFAULT_ACCOUNT_ID,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";

import {
  listRocketChatAccountIds,
  resolveDefaultRocketChatAccountId,
  resolveRocketChatAccount,
  type ResolvedRocketChatAccount,
} from "./rocketchat/accounts.js";
import { normalizeRocketChatBaseUrl } from "./rocketchat/client.js";
import { monitorRocketChatProvider } from "./rocketchat/monitor.js";
import { reactMessageRocketChat, sendMessageRocketChat } from "./rocketchat/send.js";
import { getRocketChatRuntime } from "./runtime.js";

const meta = {
  id: "rocketchat",
  label: "Rocket.Chat",
  selectionLabel: "Rocket.Chat (plugin)",
  detailLabel: "Rocket.Chat Bot",
  docsPath: "/channels/rocketchat",
  docsLabel: "rocketchat",
  blurb: "Self-hosted team chat via Rocket.Chat REST + Realtime API.",
  systemImage: "bubble.left.and.bubble.right",
  order: 66,
  aliases: ["rc", "rocket"],
  quickstartAllowFrom: true,
} as const;

function normalizeAllowEntry(entry: string): string {
  return entry
    .trim()
    .replace(/^(rocketchat|user):/i, "")
    .replace(/^@/, "")
    .toLowerCase();
}

function formatAllowEntry(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) {
    const username = trimmed.slice(1).trim();
    return username ? `@${username.toLowerCase()}` : "";
  }
  return trimmed.replace(/^(rocketchat|user):/i, "").toLowerCase();
}

function looksLikeRocketChatTargetId(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  // Rocket.Chat room IDs vary by deployment.
  // Common lengths are 17 (token-ish) and 24 (Mongo ObjectId), but allow growth.
  if (/^[A-Za-z0-9]{17,64}$/.test(trimmed)) return true;

  if (trimmed.startsWith("#") || trimmed.startsWith("@")) return true;
  if (lower.startsWith("room:")) return true;
  if (lower.startsWith("user:")) return true;

  // OpenClaw may provide channel-local targets like "rocketchat:<rid>"
  if (lower.startsWith("rocketchat:")) {
    const rest = trimmed.slice("rocketchat:".length).trim();
    if (/^[A-Za-z0-9]{17,64}$/.test(rest)) return true;
  }

  return false;
}

function normalizeRocketChatMessagingTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Normalize OpenClaw-style prefixed targets to Rocket.Chat canonical forms.
  // e.g. "rocketchat:<rid>" -> "room:<rid>"
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("rocketchat:")) {
    const rest = trimmed.slice("rocketchat:".length).trim();
    if (/^[A-Za-z0-9]{17,64}$/.test(rest)) return `room:${rest}`;
    return rest;
  }

  return trimmed;
}

export const rocketChatPlugin: ChannelPlugin<ResolvedRocketChatAccount> = {
  id: "rocketchat",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "Rocket.Chat User ID",
    normalizeAllowEntry,
    notifyApproval: async ({ cfg, id }) => {
      // Notify the user that they've been approved
      // The id is the user's Rocket.Chat user ID
      try {
        const account = resolveRocketChatAccount({ cfg, accountId: undefined });
        if (account.authToken && account.userId && account.baseUrl) {
          await sendMessageRocketChat(`user:${id}`, "✅ You've been approved! You can now send messages.", {
            accountId: account.accountId,
          });
          console.log(`[rocketchat] User ${id} approved and notified`);
        } else {
          console.log(`[rocketchat] User ${id} approved (notification skipped - account not configured)`);
        }
      } catch (err) {
        console.error(`[rocketchat] Failed to notify user ${id} of approval: ${String(err)}`);
      }
    },
  },
  capabilities: {
    chatTypes: ["direct", "channel", "group", "thread"],
    threads: true,
    media: true,
  },
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
  },
  reload: { configPrefixes: ["channels.rocketchat"] },
  config: {
    listAccountIds: (cfg) => listRocketChatAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveRocketChatAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultRocketChatAccountId(cfg),
    isConfigured: (account) =>
      Boolean(account.authToken && account.userId && account.baseUrl),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.authToken && account.userId && account.baseUrl),
      authTokenSource: account.authTokenSource,
      baseUrl: account.baseUrl,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveRocketChatAccount({ cfg, accountId }).config.allowFrom ?? []).map(String),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map((entry) => formatAllowEntry(String(entry))).filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const rcConfig = (cfg as Record<string, unknown>).channels?.rocketchat;
      const useAccountPath = Boolean(rcConfig?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.rocketchat.accounts.${resolvedAccountId}.`
        : "channels.rocketchat.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: `openclaw pairing approve rocketchat <code>`,
        normalizeEntry: normalizeAllowEntry,
      };
    },
  },
  messaging: {
    normalizeTarget: normalizeRocketChatMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeRocketChatTargetId,
      hint: "<roomId|#channel|@username|room:ID|user:USERNAME>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) =>
      getRocketChatRuntime().channel?.text?.chunkMarkdownText?.(text, limit) ?? [text],
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    resolveTarget: ({ to }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error(
            "Delivering to Rocket.Chat requires --to <roomId|#channel|@username>"
          ),
        };
      }
      return { ok: true, to: trimmed };
    },
    sendText: async ({ to, text, accountId, replyToId }) => {
      const result = await sendMessageRocketChat(to, text, {
        accountId: accountId ?? undefined,
        replyToId: replyToId ?? undefined,
      });
      return { channel: "rocketchat", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      const result = await sendMessageRocketChat(to, text, {
        accountId: accountId ?? undefined,
        mediaUrl,
        replyToId: replyToId ?? undefined,
      });
      return { channel: "rocketchat", ...result };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastConnectedAt: null,
      lastDisconnect: null,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      authTokenSource: snapshot.authTokenSource ?? "none",
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      baseUrl: snapshot.baseUrl ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.authToken && account.userId && account.baseUrl),
      authTokenSource: account.authTokenSource,
      baseUrl: account.baseUrl,
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastConnectedAt: runtime?.lastConnectedAt ?? null,
      lastDisconnect: runtime?.lastDisconnect ?? null,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.setStatus({
        accountId: account.accountId,
        baseUrl: account.baseUrl,
        authTokenSource: account.authTokenSource,
      });
      ctx.log?.info(`[${account.accountId}] starting Rocket.Chat channel`);
      return monitorRocketChatProvider({
        authToken: account.authToken ?? undefined,
        userId: account.userId ?? undefined,
        baseUrl: account.baseUrl ?? undefined,
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
    },
  },
};
