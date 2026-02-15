/**
 * Rocket.Chat message monitor - handles incoming messages via Realtime API
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import type {
  ChannelAccountSnapshot,
  OpenclawConfig,
  RuntimeEnv,
} from "openclaw/plugin-sdk";

import { createReplyPrefixContext } from "openclaw/plugin-sdk";

import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
  buildPairingReply,
  addToAllowFrom,
} from "./pairing.js";

import {
  createApproval,
  listPendingApprovals,
  findPendingApproval,
  approveRequest,
  denyRequest,
  updateApprovalNotifyMessages,
  findApprovalByMessageId,
  type PendingApproval,
} from "./approval-queue.js";

import {
  parseApprovalCommand,
  parseRoomCommand,
  buildApprovalRequestMessage,
  buildWaitingMessage,
  buildApprovedMessage,
  buildDeniedMessage,
  buildNotAuthorizedMessage,
  buildRoomUserApprovedMessage,
  buildRoomUserDeniedMessage,
  formatApprovalRequest,
} from "./approval-commands.js";

import {
  getRoomApprovedUsers,
  isRoomUserApproved,
  addRoomUser,
  removeRoomUser,
  formatRoomUsersList,
} from "./room-users.js";

import {
  isApprover,
  isNotifyChannel,
  getDmNotifyTargets,
  fetchUserRoles,
  fetchUserByUsername,
} from "./roles.js";

import { getRocketChatRuntime } from "../runtime.js";
import { resolveRocketChatAccount, type ResolvedRocketChatAccount } from "./accounts.js";
import {
  createRocketChatClient,
  fetchRocketChatMe,
  fetchRocketChatRoom,
  fetchRocketChatSubscriptions,
  normalizeRocketChatBaseUrl,
  sendRocketChatTyping,
  type RocketChatRoom,
  type RocketChatClient,
} from "./client.js";
import { RocketChatRealtime, type IncomingMessage, type RocketChatAttachment, type RocketChatFile } from "./realtime.js";
import { sendMessageRocketChat } from "./send.js";

export type MonitorRocketChatOpts = {
  authToken?: string;
  userId?: string;
  baseUrl?: string;
  accountId?: string;
  config?: OpenclawConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: Partial<ChannelAccountSnapshot>) => void;
};

const RECENT_MESSAGE_TTL_MS = 5 * 60_000;
const recentMessageIds = new Set<string>();
const processedReactions = new Set<string>(); // Track processed approval reactions
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    // Simple cleanup - just clear old messages periodically
    if (recentMessageIds.size > 1000) {
      recentMessageIds.clear();
    }
    // Also cleanup processed reactions (keep from growing indefinitely)
    if (processedReactions.size > 500) {
      processedReactions.clear();
    }
  }, RECENT_MESSAGE_TTL_MS);
}

function isDuplicate(messageId: string): boolean {
  if (recentMessageIds.has(messageId)) return true;
  recentMessageIds.add(messageId);
  return false;
}

function roomKind(roomType?: string): "dm" | "group" | "channel" {
  if (!roomType) return "channel";
  const t = roomType.trim().toLowerCase();
  if (t === "d") return "dm";
  if (t === "p" || t === "g") return "group";
  return "channel";
}

function chatType(kind: "dm" | "group" | "channel"): "direct" | "group" | "channel" {
  if (kind === "dm") return "direct";
  if (kind === "group") return "group";
  return "channel";
}

/**
 * Check if a username is an approver.
 * Looks up the user by username and checks against approver patterns.
 */
async function checkIsApprover(
  username: string,
  approverPatterns: string[],
  account: ResolvedRocketChatAccount
): Promise<boolean> {
  if (approverPatterns.length === 0) return false;
  
  const baseUrl = normalizeRocketChatBaseUrl(account.baseUrl);
  if (!baseUrl || !account.authToken || !account.userId) return false;
  
  const client = createRocketChatClient({
    baseUrl,
    userId: account.userId,
    authToken: account.authToken,
  });
  
  // First check simple @username match (no API call needed)
  const normalizedUsername = username.toLowerCase();
  for (const pattern of approverPatterns) {
    if (pattern.startsWith("@") && pattern.slice(1).toLowerCase() === normalizedUsername) {
      return true;
    }
  }
  
  // Need to fetch user for role checks or userId matches
  const user = await fetchUserByUsername(client, username);
  if (!user) return false;
  
  return isApprover(client, user._id, username, approverPatterns);
}

/**
 * Extract file URLs from Rocket.Chat message attachments/files.
 * Returns full URLs that can be fetched with auth headers.
 * Supports all file types - OpenClaw's media understanding handles type detection.
 */
function extractFileUrls(
  msg: IncomingMessage,
  baseUrl: string
): Array<{ url: string; mimeType?: string; fileName?: string }> {
  const files: Array<{ url: string; mimeType?: string; fileName?: string }> = [];

  // From file/files (used for direct uploads) - check these first as they're more reliable
  const fileList = msg.files ?? (msg.file ? [msg.file] : []);
  for (const f of fileList) {
    if (f._id && f.name) {
      // Rocket.Chat file-upload URL pattern
      const url = `${baseUrl}/file-upload/${f._id}/${encodeURIComponent(f.name)}`;
      files.push({ url, mimeType: f.type, fileName: decodeURIComponent(f.name) });
    }
  }

  // From attachments array (fallback for image_url references if no files found)
  if (files.length === 0 && msg.attachments?.length) {
    for (const att of msg.attachments) {
      if (att.image_url) {
        const url = att.image_url.startsWith("http")
          ? att.image_url
          : `${baseUrl}${att.image_url.startsWith("/") ? "" : "/"}${att.image_url}`;
        files.push({ url, mimeType: att.image_type, fileName: att.title });
      }
    }
  }

  return files;
}

type FetchedFile = {
  path: string;
  mimeType: string;
  cleanup: () => Promise<void>;
};

/** Map common MIME types to file extensions */
function getExtensionFromMime(mimeType: string): string {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return map[mime] ?? ".bin";
}

/**
 * Fetch a file from Rocket.Chat and save to a temp file.
 * Returns the file path (OpenClaw expects file paths, not data URLs).
 */
async function fetchFileToTemp(
  url: string,
  authToken: string,
  userId: string,
  mimeType?: string,
  fileName?: string
): Promise<FetchedFile | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "X-Auth-Token": authToken,
        "X-User-Id": userId,
      },
    });
    if (!res.ok) return null;

    const contentType = mimeType ?? res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = Buffer.from(await res.arrayBuffer());
    
    // Determine extension from filename or mime type
    let ext = getExtensionFromMime(contentType);
    if (fileName) {
      const fnExt = path.extname(fileName);
      if (fnExt) ext = fnExt;
    }
    
    const tempPath = path.join(os.tmpdir(), `openclaw-rc-${crypto.randomUUID()}${ext}`);
    await fs.writeFile(tempPath, buffer, { mode: 0o600 });
    
    return {
      path: tempPath,
      mimeType: contentType,
      cleanup: async () => {
        await fs.unlink(tempPath).catch(() => {});
      },
    };
  } catch {
    return null;
  }
}

export async function monitorRocketChatProvider(
  opts: MonitorRocketChatOpts
): Promise<() => void> {
  const core = getRocketChatRuntime();
  const logger = core?.logging?.getChildLogger?.({ module: "rocketchat" }) ?? {
    info: console.log,
    debug: console.log,
    error: console.error,
  };
  const cfg = opts.config ?? core?.config?.loadConfig?.() ?? {};

  const account = resolveRocketChatAccount({
    cfg,
    accountId: opts.accountId,
  });

  const authToken = opts.authToken?.trim() || account.authToken?.trim();
  const userId = opts.userId?.trim() || account.userId?.trim();
  const baseUrl = normalizeRocketChatBaseUrl(opts.baseUrl ?? account.baseUrl);

  if (!authToken || !userId || !baseUrl) {
    throw new Error("Rocket.Chat requires baseUrl, userId, and authToken");
  }

  startCleanupTimer();

  const roomCache = new Map<string, RocketChatRoom>();
  const restClient = createRocketChatClient({ baseUrl, userId, authToken });

  async function getRoom(roomId: string): Promise<RocketChatRoom | null> {
    const cached = roomCache.get(roomId);
    if (cached) return cached;
    try {
      const client = createRocketChatClient({ baseUrl, userId, authToken });
      const room = await fetchRocketChatRoom(client, roomId);
      roomCache.set(roomId, room);
      return room;
    } catch {
      return null;
    }
  }

  let refreshTimer: NodeJS.Timeout | null = null;

  async function refreshSubscriptions(): Promise<void> {
    const client = createRocketChatClient({ baseUrl, userId, authToken });
    try {
      const subscriptions = await fetchRocketChatSubscriptions(client);
      // Subscribe to *all* rooms this user is a member of, including DMs.
      // Some Rocket.Chat servers mark DMs (and other rooms) as open=false until the user opens them in the UI;
      // filtering on `open` breaks DM delivery.
      const roomIds = subscriptions
        .filter((sub) => sub.t !== "l")
        .map((sub) => sub.rid);

      logger.info?.(`[${account.accountId}] Refresh subscriptions: subscribing to ${roomIds.length} rooms`);
      await realtime.subscribeToRooms(roomIds);
    } catch (err) {
      logger.error?.(`[${account.accountId}] Failed to refresh subscriptions: ${String(err)}`);
    }
  }

  function scheduleRefreshSubscriptions(delayMs = 1000): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshSubscriptions();
    }, delayMs);
  }

  const realtime = new RocketChatRealtime({
    baseUrl,
    userId,
    authToken,
    logger: {
      debug: (msg) => logger.debug?.(msg),
      info: (msg) => logger.info?.(msg),
    },
    onConnect: () => {
      logger.info?.(`[${account.accountId}] Connected to Rocket.Chat realtime`);
      opts.statusSink?.({
        connected: true,
        lastConnectedAt: Date.now(),
      });
    },
    onDisconnect: (reason) => {
      logger.info?.(`[${account.accountId}] Disconnected: ${reason ?? "unknown"}`);
      opts.statusSink?.({
        connected: false,
        lastDisconnect: { at: Date.now(), reason },
      });
    },
    onError: (err) => {
      logger.error?.(`[${account.accountId}] Realtime error: ${err.message}`);
      opts.statusSink?.({ lastError: err.message });
    },
    onNotify: (evt) => {
      // Try to catch subscription changes and refresh room subscriptions.
      if (evt.collection === "stream-notify-user" && evt.eventName?.includes("subscriptions-changed")) {
        logger.info?.(`[${account.accountId}] subscriptions-changed detected (${evt.eventName}); refreshing...`);
        scheduleRefreshSubscriptions(250);
      }
    },
    onMessage: async (msg) => {
      try {
        const me = await fetchRocketChatMe(restClient).catch(() => null);
        const botUsername = me?.username;

        await handleIncomingMessage(
          msg,
          account,
          cfg,
          core,
          getRoom,
          logger,
          opts.statusSink,
          async (roomId, isTyping, meta) => {
            // Prefer DDP websocket method for typing indicators.
            // Match Rocket.Chat web client behavior:
            // stream-notify-room: ["<RID>/user-activity", "<username>", ["user-typing"|"user-stopped-typing"], { tmid? }]
            if (botUsername) {
              const room = await getRoom(roomId);
              // Rocket.Chat stream-notify-room uses the room id (rid), not the human channel name.
              // Example for #general default channel: rid="GENERAL" while name="general".
              const roomKey = room?._id ?? roomId;

              const activity = isTyping ? "user-typing" : "user-stopped-typing";
              const eventName = `${roomKey}/user-activity`;

              logger.debug?.(
                `[rocketchat] typing:${isTyping ? "start" : "stop"} event=${eventName} user=${botUsername} meta=${JSON.stringify(meta)}`
              );

              const result = await realtime.callMethod("stream-notify-room", [
                eventName,
                botUsername,
                [activity],
                meta,
              ]);

              logger.debug?.(
                `[rocketchat] typing:${isTyping ? "start" : "stop"} result ok event=${eventName} user=${botUsername}`
              );

              void result;
              return;
            }

            // Fallback to REST if we can't resolve username.
            await sendRocketChatTyping(restClient, roomId, Boolean(isTyping));
          }
        );
      } catch (err) {
        logger.error?.(`Failed to handle message: ${err}`);
      }
    },
  });

  // Connect and subscribe to all rooms
  await realtime.connect();
  
  // Subscribe to current rooms
  await refreshSubscriptions();

  // Try to subscribe to subscription change notifications (best-effort).
  // In Rocket.Chat, user notifications are typically on stream-notify-user.
  // We'll refresh on any subscriptions-changed notification.
  await realtime.subscribeToUserEvent(`${userId}/subscriptions-changed`).catch(() => undefined);

  opts.statusSink?.({
    running: true,
    lastStartAt: Date.now(),
  });

  // Handle abort signal
  opts.abortSignal?.addEventListener("abort", () => {
    realtime.disconnect();
    opts.statusSink?.({
      running: false,
      lastStopAt: Date.now(),
    });
  });

  return () => {
    realtime.disconnect();
    opts.statusSink?.({
      running: false,
      lastStopAt: Date.now(),
    });
  };
}

async function handleIncomingMessage(
  msg: IncomingMessage,
  account: ResolvedRocketChatAccount,
  cfg: OpenclawConfig,
  core: RuntimeEnv,
  getRoom: (roomId: string) => Promise<RocketChatRoom | null>,
  logger: { info?: (msg: string) => void; debug?: (msg: string) => void; error?: (msg: string) => void },
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void,
  setTypingFn?: (roomId: string, isTyping: boolean, meta?: Record<string, unknown>) => Promise<void>
): Promise<void> {
  // Skip duplicates (but allow reaction updates on tracked approval messages)
  const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0;
  if (isDuplicate(msg._id) && !hasReactions) return;

  // Skip own messages
  if (msg.u._id === account.userId) return;

  // === Reaction-based approval handling ===
  // Check if this message has reactions and is a tracked approval notification
  if (hasReactions) {
    try {
      const approval = await findApprovalByMessageId(msg._id);
      if (approval && approval.status === "pending") {
        // Check for approve/deny reactions
        const approveEmojis = [":white_check_mark:", ":heavy_check_mark:", ":thumbsup:", ":+1:"];
        const denyEmojis = [":x:", ":negative_squared_cross_mark:", ":thumbsdown:", ":-1:"];
        
        // Get owner approval config to check if reactor is an approver
        const ownerConfig = account.config.ownerApproval ?? {};
        const approvers = ownerConfig.approvers ?? [];
        
        for (const [emoji, reaction] of Object.entries(msg.reactions ?? {})) {
          const normalizedEmoji = emoji.toLowerCase();
          const isApproveEmoji = approveEmojis.some(e => normalizedEmoji.includes(e.replace(/:/g, "")));
          const isDenyEmoji = denyEmojis.some(e => normalizedEmoji.includes(e.replace(/:/g, "")));
          
          if (!isApproveEmoji && !isDenyEmoji) continue;
          
          // Check if any reactor is an approver
          for (const username of reaction.usernames ?? []) {
            const isApprover = await checkIsApprover(username, approvers, account);
            if (!isApprover) continue;
            
            // Generate a unique key to avoid re-processing the same reaction
            const reactionKey = `${msg._id}:${emoji}:${username}`;
            if (processedReactions.has(reactionKey)) continue;
            processedReactions.add(reactionKey);
            
            // Process the approval/denial
            if (isApproveEmoji) {
              const result = await approveRequest(
                approval.type === "dm" ? (approval.targetUsername ?? approval.targetId) : approval.targetId,
                username,
                approval.type
              );
              if (result) {
                // Add to allowlist
                if (approval.type === "dm") {
                  await addToAllowFrom(approval.targetId);
                } else {
                  await addToAllowFrom(approval.targetId, "rocketchat-rooms");
                }
                
                // Notify the requester
                const message = approval.type === "dm" 
                  ? buildApprovedMessage(approval.targetUsername ?? approval.targetId, "dm")
                  : buildApprovedMessage(approval.targetName ?? approval.targetId, "room");
                await sendMessageRocketChat(`room:${approval.replyRoomId}`, message, { accountId: account.accountId });
                
                logger.info?.(`[${account.accountId}] ${approval.type === "dm" ? "User" : "Room"} ${approval.targetUsername ?? approval.targetName ?? approval.targetId} approved via reaction by ${username}`);
              }
            } else if (isDenyEmoji) {
              const result = await denyRequest(
                approval.type === "dm" ? (approval.targetUsername ?? approval.targetId) : approval.targetId,
                username,
                approval.type
              );
              if (result) {
                // Notify the requester
                const message = buildDeniedMessage(approval.targetUsername ?? approval.targetName ?? approval.targetId, approval.type);
                await sendMessageRocketChat(`room:${approval.replyRoomId}`, message, { accountId: account.accountId });
                
                logger.info?.(`[${account.accountId}] ${approval.type === "dm" ? "User" : "Room"} ${approval.targetUsername ?? approval.targetName ?? approval.targetId} denied via reaction by ${username}`);
              }
            }
            
            // Only process one approver's reaction per message
            return;
          }
        }
      }
    } catch (err) {
      logger.error?.(`[${account.accountId}] Failed to process reaction-based approval: ${String(err)}`);
    }
    
    // If this was a duplicate (already processed as a regular message), return now
    if (isDuplicate(msg._id)) return;
  }

  // Skip system messages
  if (msg.t) return;

  const room = await getRoom(msg.rid);
  const kind = roomKind(room?.t);
  const isGroup = kind !== "dm";

  const roomRid = room?._id ?? msg.rid;
  const roomCfg = (account.config.rooms?.[roomRid] ?? {}) as { replyMode?: "thread" | "channel" | "auto" };

  // === Pairing / Access Control for DMs ===
  // Check dmPolicy before processing DMs (groups use separate groupPolicy)
  if (!isGroup) {
    const dmPolicy = account.config.dmPolicy ?? "open"; // Default to "open" for Rocket.Chat (server-level auth)
    const senderId = msg.u._id;
    const senderUsername = msg.u.username;
    const senderName = msg.u.name ?? senderUsername;

    // If disabled, silently drop
    if (dmPolicy === "disabled") {
      logger.debug?.(`[${account.accountId}] DM from ${senderUsername ?? senderId} blocked (dmPolicy=disabled)`);
      return;
    }

    // If not "open", check allowlist
    if (dmPolicy !== "open") {
      // Normalize helper (matches channel.ts)
      const normalizeAllowEntry = (entry: string): string =>
        entry
          .trim()
          .replace(/^(rocketchat|user):/i, "")
          .replace(/^@/, "")
          .toLowerCase();

      // Read allowlist from pairing store + config
      const storeAllowFrom = await readChannelAllowFromStore("rocketchat").catch(() => []);
      const configAllowFrom = (account.config.allowFrom ?? []).map(String).map(normalizeAllowEntry);
      const allAllowFrom = [...new Set([...storeAllowFrom, ...configAllowFrom])];

      // Check if sender is allowed
      const normalizedSenderId = normalizeAllowEntry(senderId);
      const normalizedUsername = senderUsername ? normalizeAllowEntry(senderUsername) : null;
      const isAllowed = allAllowFrom.some(
        (entry) =>
          entry === "*" ||
          entry === normalizedSenderId ||
          (normalizedUsername && entry === normalizedUsername)
      );

      if (!isAllowed) {
        // If "allowlist" mode, block without pairing
        if (dmPolicy === "allowlist") {
          logger.debug?.(`[${account.accountId}] DM from ${senderUsername ?? senderId} blocked (dmPolicy=allowlist, not in allowFrom)`);
          return;
        }

        // If "pairing" mode, create pairing request and send code
        if (dmPolicy === "pairing") {
          try {
            const { code, created } = await upsertChannelPairingRequest({
              id: senderId,
              meta: {
                name: senderName ?? undefined,
                username: senderUsername ?? undefined,
              },
            });

            if (created) {
              logger.info?.(`[${account.accountId}] Pairing request created for ${senderUsername ?? senderId}, code: ${code}`);
              const reply = buildPairingReply({
                idLine: `Rocket.Chat user: ${senderUsername ? `@${senderUsername}` : senderId}`,
                code,
              });
              await sendMessageRocketChat(`room:${msg.rid}`, reply, {
                accountId: account.accountId,
              });
            } else {
              logger.debug?.(`[${account.accountId}] Pairing request already exists for ${senderUsername ?? senderId}`);
            }
          } catch (err) {
            logger.error?.(`[${account.accountId}] Failed to create pairing request: ${String(err)}`);
          }
          return;
        }

        // If "owner-approval" mode, use owner channel approval flow
        if (dmPolicy === "owner-approval") {
          const ownerConfig = account.config.ownerApproval;
          if (!ownerConfig?.enabled) {
            logger.debug?.(`[${account.accountId}] DM from ${senderUsername ?? senderId} blocked (dmPolicy=owner-approval but ownerApproval not enabled)`);
            return;
          }

          // Approvers are always allowed through — they need DM access
          // to send approval commands (approve/deny/list) and to chat.
          const approvers = ownerConfig.approvers ?? [];
          if (approvers.length > 0) {
            const restClient = createRocketChatClient({
              baseUrl: account.baseUrl!,
              userId: account.userId!,
              authToken: account.authToken!,
            });
            if (await isApprover(restClient, senderId, senderUsername, approvers)) {
              logger.debug?.(`[${account.accountId}] DM from ${senderUsername ?? senderId} allowed (sender is approver)`);
              // Fall through to normal message processing (skip access control)
            } else {
              // Not an approver — run the approval request flow
              try {
                const existing = await findPendingApproval(senderId, "dm");
                if (existing?.status === "approved") {
                  await addToAllowFrom(senderId);
                  // Fall through to normal message processing
                } else {
                  const approval = await createApproval({
                    type: "dm",
                    targetId: senderId,
                    targetName: senderName,
                    targetUsername: senderUsername,
                    requesterId: senderId,
                    requesterName: senderName,
                    requesterUsername: senderUsername,
                    replyRoomId: msg.rid,
                    timeoutMs: ownerConfig.timeout ? ownerConfig.timeout * 1000 : undefined,
                  });

                  if (approval.createdAt === approval.lastNotifiedAt) {
                    const notifyChannels = ownerConfig.notifyChannels ?? [];
                    const notifyMessage = buildApprovalRequestMessage({
                      type: "dm",
                      targetId: senderId,
                      targetName: senderName,
                      targetUsername: senderUsername,
                    });

                    // Track notification message IDs for reaction-based approval
                    const notifyMessageIds: Array<{ roomId: string; messageId: string }> = [];

                    for (const channel of notifyChannels) {
                      try {
                        let result;
                        if (channel.startsWith("@")) {
                          result = await sendMessageRocketChat(`user:${channel.slice(1)}`, notifyMessage, { accountId: account.accountId });
                        } else if (channel.startsWith("room:")) {
                          result = await sendMessageRocketChat(channel, notifyMessage, { accountId: account.accountId });
                        } else if (channel.startsWith("#")) {
                          result = await sendMessageRocketChat(`room:${channel.slice(1)}`, notifyMessage, { accountId: account.accountId });
                        } else {
                          result = await sendMessageRocketChat(`room:${channel}`, notifyMessage, { accountId: account.accountId });
                        }
                        if (result?.messageId && result?.roomId) {
                          notifyMessageIds.push({ roomId: result.roomId, messageId: result.messageId });
                        }
                      } catch (err) {
                        logger.error?.(`[${account.accountId}] Failed to send approval notification to ${channel}: ${String(err)}`);
                      }
                    }

                    // Store notification message IDs for reaction-based approval
                    if (notifyMessageIds.length > 0) {
                      await updateApprovalNotifyMessages(approval.id, notifyMessageIds);
                    }

                    await sendMessageRocketChat(`room:${msg.rid}`, buildWaitingMessage(), { accountId: account.accountId });
                    logger.info?.(`[${account.accountId}] Approval request created for ${senderUsername ?? senderId}`);
                  }

                  return; // Don't process the message yet
                }
              } catch (err) {
                logger.error?.(`[${account.accountId}] Failed to handle owner-approval flow: ${String(err)}`);
                return;
              }
            }
          }
        }
      }
    }
  }

  // === Access Control for Groups/Channels ===
  // Check groupPolicy before processing messages from groups/channels
  if (isGroup) {
    const groupPolicy = account.config.groupPolicy ?? "open"; // Default to "open" for Rocket.Chat
    const roomId = msg.rid;
    const roomName = room?.name ?? room?.fname ?? roomId;
    const senderId = msg.u._id;
    const senderUsername = msg.u.username;
    const senderName = msg.u.name ?? senderUsername;

    // If disabled, silently drop all group messages
    if (groupPolicy === "disabled") {
      logger.debug?.(`[${account.accountId}] Group message from ${roomName} blocked (groupPolicy=disabled)`);
      return;
    }

    // If not "open", check if room is allowed
    if (groupPolicy !== "open") {
      // Normalize helper
      const normalizeRoomEntry = (entry: string): string =>
        entry
          .trim()
          .replace(/^(rocketchat|room):/i, "")
          .replace(/^#/, "")
          .toLowerCase();

      // Read allowed rooms from store + config
      const storeAllowFrom = await readChannelAllowFromStore("rocketchat-rooms").catch(() => []);
      const configAllowFrom = (account.config.groupAllowFrom ?? []).map(String).map(normalizeRoomEntry);
      const allAllowFrom = [...new Set([...storeAllowFrom, ...configAllowFrom])];

      // Check if room is allowed
      const normalizedRoomId = normalizeRoomEntry(roomId);
      const normalizedRoomName = roomName ? normalizeRoomEntry(roomName) : null;
      
      // Auto-allow notifyChannels (they need to receive approval notifications)
      const ownerConfigForCheck = account.config.ownerApproval;
      const notifyChannels = ownerConfigForCheck?.notifyChannels ?? [];
      const isNotifyChannelRoom = isNotifyChannel(roomId, roomName, notifyChannels);
      
      const isAllowed = isNotifyChannelRoom || allAllowFrom.some(
        (entry) =>
          entry === "*" ||
          entry === normalizedRoomId ||
          (normalizedRoomName && entry === normalizedRoomName)
      );

      if (!isAllowed) {
        // If "allowlist" mode, block without approval
        if (groupPolicy === "allowlist") {
          logger.debug?.(`[${account.accountId}] Group message from ${roomName} blocked (groupPolicy=allowlist, not in groupAllowFrom)`);
          return;
        }

        // If "owner-approval" mode, create approval request
        if (groupPolicy === "owner-approval") {
          const ownerConfig = account.config.ownerApproval;
          if (!ownerConfig?.enabled) {
            logger.debug?.(`[${account.accountId}] Group message from ${roomName} blocked (groupPolicy=owner-approval but ownerApproval not enabled)`);
            return;
          }

          // Approvers are allowed through in any room
          const approvers = ownerConfig.approvers ?? [];
          if (approvers.length > 0) {
            const restClient = createRocketChatClient({
              baseUrl: account.baseUrl!,
              userId: account.userId!,
              authToken: account.authToken!,
            });
            if (await isApprover(restClient, senderId, senderUsername, approvers)) {
              logger.debug?.(`[${account.accountId}] Group message from ${roomName} allowed (sender ${senderUsername} is approver)`);
              // Fall through to normal message processing
            } else {
              // Not an approver — check for pending room approval
              try {
                const existing = await findPendingApproval(roomId, "room");
                if (existing?.status === "approved") {
                  // Room was approved, add to allowed list
                  await addToAllowFrom(roomId, "rocketchat-rooms");
                  // Fall through to normal message processing
                } else if (!existing) {
                  // Create new approval request for this room
                  const approval = await createApproval({
                    type: "room",
                    targetId: roomId,
                    targetName: roomName,
                    requesterId: senderId,
                    requesterName: senderName,
                    requesterUsername: senderUsername,
                    replyRoomId: roomId,
                    timeoutMs: ownerConfig.timeout ? ownerConfig.timeout * 1000 : undefined,
                  });

                  // Notify approvers
                  const notifyChannels = ownerConfig.notifyChannels ?? [];
                  const notifyMessage = buildApprovalRequestMessage({
                    type: "room",
                    targetId: roomId,
                    targetName: roomName,
                    requesterName: senderName,
                    requesterUsername: senderUsername,
                  });

                  // Track notification message IDs for reaction-based approval
                  const notifyMessageIds: Array<{ roomId: string; messageId: string }> = [];

                  for (const channel of notifyChannels) {
                    try {
                      let result;
                      if (channel.startsWith("@")) {
                        result = await sendMessageRocketChat(`user:${channel.slice(1)}`, notifyMessage, {
                          accountId: account.accountId,
                        });
                      } else if (channel.startsWith("room:")) {
                        result = await sendMessageRocketChat(channel, notifyMessage, {
                          accountId: account.accountId,
                        });
                      } else {
                        result = await sendMessageRocketChat(`room:${channel}`, notifyMessage, {
                          accountId: account.accountId,
                        });
                      }
                      if (result?.messageId && result?.roomId) {
                        notifyMessageIds.push({ roomId: result.roomId, messageId: result.messageId });
                      }
                    } catch (err) {
                      logger.error?.(`[${account.accountId}] Failed to send room approval notification to ${channel}: ${String(err)}`);
                    }
                  }

                  // Store notification message IDs for reaction-based approval
                  if (notifyMessageIds.length > 0) {
                    await updateApprovalNotifyMessages(approval.id, notifyMessageIds);
                  }

                  // Notify the room that it's pending approval
                  await sendMessageRocketChat(`room:${roomId}`, "⏳ This room is pending approval. The owner has been notified.", {
                    accountId: account.accountId,
                  });

                  logger.info?.(`[${account.accountId}] Room approval request created for ${roomName}`);
                }
                // If pending, silently drop (already notified)
                return;
              } catch (err) {
                logger.error?.(`[${account.accountId}] Failed to handle room approval flow: ${String(err)}`);
                return;
              }
            }
          }
        }
      }
    }
  }

  // === Per-Room User Access Control ===
  // After room is approved, check if this specific user can interact
  if (isGroup) {
    const roomId = msg.rid;
    const roomName = room?.name ?? room?.fname ?? roomId;
    const senderId = msg.u._id;
    const senderUsername = msg.u.username;
    const senderName = msg.u.name ?? senderUsername;
    
    // Get room-specific config
    const roomConfig = (account.config.rooms?.[roomId] ?? {}) as {
      responseMode?: "always" | "mention-only";
      canInteract?: string[];
      roomApprovers?: string[];
      onMentionUnauthorized?: "ignore" | "reply";
    };
    
    // Check if room has per-user access control configured
    const hasRoomAccessControl = roomConfig.canInteract?.length || roomConfig.roomApprovers?.length;
    
    if (hasRoomAccessControl) {
      // Check if sender is a room approver (they always have access)
      const roomApprovers = roomConfig.roomApprovers ?? [];
      let isRoomApprover = false;
      
      if (roomApprovers.length > 0) {
        const restClient = createRocketChatClient({
          baseUrl: account.baseUrl!,
          userId: account.userId!,
          authToken: account.authToken!,
        });
        isRoomApprover = await isApprover(restClient, senderId, senderUsername, roomApprovers);
      }
      
      // Check if sender is in canInteract list (static config)
      const canInteract = roomConfig.canInteract ?? [];
      let isInCanInteract = false;
      
      if (canInteract.length > 0) {
        const restClient = createRocketChatClient({
          baseUrl: account.baseUrl!,
          userId: account.userId!,
          authToken: account.authToken!,
        });
        isInCanInteract = await isApprover(restClient, senderId, senderUsername, canInteract);
      }
      
      // Check if sender is in dynamic room users list
      const isInRoomUsers = await isRoomUserApproved(roomId, senderId, senderUsername);
      
      // Also check if sender is a global approver (they can interact anywhere)
      const globalApprovers = account.config.ownerApproval?.approvers ?? [];
      let isGlobalApprover = false;
      if (globalApprovers.length > 0) {
        const restClient = createRocketChatClient({
          baseUrl: account.baseUrl!,
          userId: account.userId!,
          authToken: account.authToken!,
        });
        isGlobalApprover = await isApprover(restClient, senderId, senderUsername, globalApprovers);
      }
      
      const canUserInteract = isRoomApprover || isInCanInteract || isInRoomUsers || isGlobalApprover;
      
      // Check if this is a room command from a room approver
      if (isRoomApprover || isGlobalApprover) {
        const roomCommand = parseRoomCommand(msg.msg);
        
        if (roomCommand) {
          logger.debug?.(`[${account.accountId}] Room command from ${senderUsername}: ${JSON.stringify(roomCommand)}`);
          
          if (roomCommand.action === "room-list") {
            const users = await getRoomApprovedUsers(roomId);
            await sendMessageRocketChat(`room:${roomId}`, formatRoomUsersList(users), {
              accountId: account.accountId,
            });
            return;
          }
          
          if (roomCommand.action === "room-approve") {
            const results: string[] = [];
            
            for (const target of roomCommand.targets) {
              const username = target.replace(/^@/, "");
              
              // Look up user by username
              const restClient = createRocketChatClient({
                baseUrl: account.baseUrl!,
                userId: account.userId!,
                authToken: account.authToken!,
              });
              
              try {
                const userInfo = await fetchUserByUsername(restClient, username);
                if (userInfo) {
                  const { added, existing } = await addRoomUser({
                    roomId,
                    userId: userInfo.userId,
                    username: userInfo.username,
                    approvedBy: senderUsername ?? senderId,
                  });
                  
                  if (added) {
                    results.push(buildRoomUserApprovedMessage(username));
                  } else if (existing) {
                    results.push(`ℹ️ @${username} is already approved for this room.`);
                  }
                } else {
                  results.push(`⚠️ User not found: ${username}`);
                }
              } catch (err) {
                results.push(`⚠️ Failed to approve ${username}: ${String(err)}`);
              }
            }
            
            await sendMessageRocketChat(`room:${roomId}`, results.join("\n"), {
              accountId: account.accountId,
            });
            return;
          }
          
          if (roomCommand.action === "room-deny") {
            const results: string[] = [];
            
            for (const target of roomCommand.targets) {
              const username = target.replace(/^@/, "");
              
              const { removed } = await removeRoomUser({
                roomId,
                username,
              });
              
              if (removed) {
                results.push(buildRoomUserDeniedMessage(username));
              } else {
                results.push(`⚠️ @${username} was not in this room's approved list.`);
              }
            }
            
            await sendMessageRocketChat(`room:${roomId}`, results.join("\n"), {
              accountId: account.accountId,
            });
            return;
          }
        }
      }
      
      // If user can't interact, check response mode and handle accordingly
      if (!canUserInteract) {
        const responseMode = roomConfig.responseMode ?? "always";
        const onMentionUnauthorized = roomConfig.onMentionUnauthorized ?? "ignore";
        
        // Check if bot was @mentioned
        const botUsername = account.userId; // This should be resolved to username
        const wasMentioned = msg.mentions?.some((m: { _id: string }) => m._id === account.userId);
        
        if (wasMentioned && onMentionUnauthorized === "reply") {
          await sendMessageRocketChat(`room:${roomId}`, buildNotAuthorizedMessage(), {
            accountId: account.accountId,
          });
        }
        
        logger.debug?.(`[${account.accountId}] User ${senderUsername} not authorized in room ${roomName}`);
        return;
      }
      
      // User can interact - check responseMode
      const responseMode = roomConfig.responseMode ?? "always";
      if (responseMode === "mention-only") {
        const wasMentioned = msg.mentions?.some((m: { _id: string }) => m._id === account.userId);
        if (!wasMentioned) {
          logger.debug?.(`[${account.accountId}] Ignoring message from ${senderUsername} in ${roomName} (mention-only mode)`);
          return;
        }
      }
    }
  }

  // === Owner Approval Command Handling ===
  // Check if this message is an approval command from an approver
  const ownerConfig = account.config.ownerApproval;
  if (ownerConfig?.enabled) {
    const approvers = ownerConfig.approvers ?? [];
    const notifyChannels = ownerConfig.notifyChannels ?? [];
    
    // Check if sender is an approver
    const restClient = createRocketChatClient({
      baseUrl: account.baseUrl!,
      userId: account.userId!,
      authToken: account.authToken!,
    });
    
    const senderIsApprover = await isApprover(
      restClient,
      msg.u._id,
      msg.u.username,
      approvers
    );

    // Check if this room is a notify channel
    const roomName = room?.name ?? room?.fname;
    const roomIsNotifyChannel = isNotifyChannel(msg.rid, roomName, notifyChannels);
    
    // Also check if this is a DM with the bot (approvers can send commands via DM)
    const isDmWithBot = !isGroup;

    if (senderIsApprover && (roomIsNotifyChannel || isDmWithBot)) {
      const command = parseApprovalCommand(msg.msg);
      
      if (command) {
        logger.debug?.(`[${account.accountId}] Approval command from ${msg.u.username}: ${JSON.stringify(command)}`);
        
        if (command.action === "list") {
          // List pending approvals
          const pending = await listPendingApprovals();
          if (pending.length === 0) {
            await sendMessageRocketChat(`room:${msg.rid}`, "✅ No pending approvals.", {
              accountId: account.accountId,
            });
          } else {
            const lines = pending.map(formatApprovalRequest);
            await sendMessageRocketChat(`room:${msg.rid}`, `📋 **Pending approvals (${pending.length})**\n\n${lines.join("\n")}`, {
              accountId: account.accountId,
            });
          }
          return; // Don't process as regular message
        }

        if (command.action === "approve" || command.action === "deny") {
          const results: string[] = [];
          
          for (const target of command.targets) {
            // Determine type from target format
            const type = target.startsWith("room:") ? "room" : "dm";
            const cleanTarget = target.replace(/^room:/, "").replace(/^@/, "");
            
            let approval: PendingApproval | null;
            if (command.action === "approve") {
              approval = await approveRequest(cleanTarget, msg.u._id, type === "room" ? "room" : "dm");
            } else {
              approval = await denyRequest(cleanTarget, msg.u._id, type === "room" ? "room" : "dm");
            }

            if (approval) {
              // Add to allowlist if approved
              if (command.action === "approve") {
                // Use different store for rooms vs users
                const storeId = approval.type === "room" ? "rocketchat-rooms" : "rocketchat";
                await addToAllowFrom(approval.targetId, storeId);
              }

              // Notify the requester
              const shouldNotify = command.action === "approve" 
                ? ownerConfig.notifyOnApprove !== false
                : ownerConfig.notifyOnDeny === true;
              
              if (shouldNotify) {
                try {
                  const message = command.action === "approve"
                    ? buildApprovedMessage(approval.targetId, approval.type)
                    : buildDeniedMessage(approval.targetId, approval.type);
                  
                  await sendMessageRocketChat(`room:${approval.replyRoomId}`, message, {
                    accountId: account.accountId,
                  });
                } catch (err) {
                  logger.error?.(`[${account.accountId}] Failed to notify requester: ${String(err)}`);
                }
              }

              const targetLabel = approval.targetUsername 
                ? `@${approval.targetUsername}` 
                : approval.targetId;
              results.push(`${command.action === "approve" ? "✅" : "❌"} ${targetLabel}`);
            } else {
              results.push(`⚠️ No pending request for: ${target}`);
            }
          }

          await sendMessageRocketChat(`room:${msg.rid}`, results.join("\n"), {
            accountId: account.accountId,
          });
          return; // Don't process as regular message
        }
      }
    }
  }

  // Get timestamp
  const ts = typeof msg.ts === "object" && "$date" in msg.ts 
    ? msg.ts.$date 
    : Date.parse(String(msg.ts));

  // Extract file attachments (images, PDFs, documents, etc.)
  const baseUrl = account.baseUrl;
  const authToken = account.authToken;
  const userId = account.userId;
  
  // DEBUG: Log raw message to see what DDP sends
  logger.debug?.(`[RC DEBUG] Raw message: file=${JSON.stringify(msg.file)} files=${JSON.stringify(msg.files)} attachments=${JSON.stringify(msg.attachments?.slice(0, 2))}`);
  
  const fileRefs = extractFileUrls(msg, baseUrl);
  logger.debug?.(`[RC DEBUG] Extracted ${fileRefs.length} file refs`);
  
  let rawBody = msg.msg.trim();
  
  // Allow messages with only file attachments (no text)
  if (!rawBody && fileRefs.length === 0) return;

  // Optional per-message overrides
  // - !thread  -> force reply in thread
  // - !channel -> force reply in channel
  let forcedReplyMode: "thread" | "channel" | undefined;
  if (/^!thread\b/i.test(rawBody)) {
    forcedReplyMode = "thread";
    rawBody = rawBody.replace(/^!thread\b\s*/i, "").trim();
  } else if (/^!channel\b/i.test(rawBody)) {
    forcedReplyMode = "channel";
    rawBody = rawBody.replace(/^!channel\b\s*/i, "").trim();
  }
  // Skip if no text and no file attachments
  if (!rawBody && fileRefs.length === 0) return;

  // Determine reply mode
  const baseReplyMode: "thread" | "channel" | "auto" =
    forcedReplyMode ??
    roomCfg.replyMode ??
    // back-compat: replyInThread overrides replyMode if present
    (account.config.replyInThread === true
      ? "thread"
      : account.config.replyInThread === false
        ? "channel"
        : (account.config.replyMode ?? "thread"));

  const resolvedReplyMode: "thread" | "channel" = (() => {
    if (baseReplyMode === "thread" || baseReplyMode === "channel") return baseReplyMode;
    // auto rules
    // 1) If message is already in a thread -> stay in that thread.
    if (msg.tmid) return "thread";
    // 2) If message looks "long" -> thread to reduce channel noise.
    if (rawBody.length >= 280 || rawBody.includes("\n")) return "thread";
    // 3) Otherwise reply in channel.
    return "channel";
  })();

  logger.debug?.(
    `Reply routing: forced=${forcedReplyMode ?? ""} base=${baseReplyMode} resolved=${resolvedReplyMode} msg.tmid=${msg.tmid ?? ""}`
  );

  const senderId = msg.u._id;
  const senderName = msg.u.name ?? msg.u.username;
  const roomId = msg.rid;
  const roomName = room?.name ?? room?.fname ?? roomId;

  logger.debug?.(`Incoming message from ${msg.u.username} in ${roomName}: ${rawBody.slice(0, 50)}`);
  logger.debug?.(`Message meta: id=${msg._id} rid=${msg.rid} tmid=${msg.tmid ?? ""}`);

  // Record activity
  statusSink?.({ lastInboundAt: ts });
  core?.channel?.activity?.record?.({
    channel: "rocketchat",
    accountId: account.accountId,
    direction: "inbound",
  });

  // Resolve agent route
  const route = core.channel?.routing?.resolveAgentRoute?.({
    cfg,
    channel: "rocketchat",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "dm",
      id: isGroup ? roomId : senderId,
    },
  }) ?? {
    agentId: "main",
    sessionKey: `rocketchat:${isGroup ? "group" : "dm"}:${isGroup ? roomId : senderId}`,
    accountId: account.accountId,
  };

  // Build from label
  const fromLabel = isGroup
    ? `room:${roomName}`
    : senderName || `user:${senderId}`;

  // Get envelope format options
  const envelopeOptions = core.channel?.reply?.resolveEnvelopeFormatOptions?.(cfg) ?? {};
  
  // Get store path
  const storePath = core.channel?.session?.resolveStorePath?.(cfg.session?.store, {
    agentId: route.agentId,
  });

  // Get previous timestamp for envelope
  const previousTimestamp = storePath
    ? core.channel?.session?.readSessionUpdatedAt?.({
        storePath,
        sessionKey: route.sessionKey,
      })
    : undefined;

  // Format the envelope body
  // For attachment-only messages, use a placeholder so the agent knows there's content
  const effectiveRawBody = rawBody || (fileRefs.length > 0 ? "[attachment]" : "");
  const body = core.channel?.reply?.formatAgentEnvelope?.({
    channel: "Rocket.Chat",
    from: fromLabel,
    timestamp: ts,
    previousTimestamp,
    envelope: envelopeOptions,
    body: effectiveRawBody,
  }) ?? effectiveRawBody;


  // Inline directives (e.g. /model <ref>) should be parsed from the raw inbound text.
  // Rocket.Chat users often type one-line directives like: "/model qwen3 hello".
  // We split a leading directive into:
  // - BodyForCommands: directive-only (so OpenClaw applies it)
  // - BodyForAgent: the full envelope (so the agent retains context)
  const normalizedRawBody = rawBody
    // Shorthands (Rocket.Chat doesn't reliably allow leading `/...`)
    .replace(/^\s*--opus\b/i, "/model opus")
    .replace(/^\s*-opus\b/i, "/model opus")
    .replace(/^\s*--oss\b/i, "/model oss")
    .replace(/^\s*-oss\b/i, "/model oss")
    .replace(/^\s*--model\b/i, "/model")
    .replace(/^\s*-model\b/i, "/model")
    // Generic: `--foo` => `/foo` (we intentionally do NOT do this for single-dash to avoid
    // accidental triggers on markdown bullets / negative numbers).
    .replace(/^\s*--/, "/");

  const bodyForCommands = (() => {
    const t = normalizedRawBody.trim();
    if (!t.startsWith("/")) return normalizedRawBody;

    // IMPORTANT: Rocket.Chat users can't reliably send leading `/...` (Rocket.Chat treats it as an internal slash command).
    // We allow `--...` as a stand-in for `/...`.
    //
    // For directives like `/think high`, `/verbose full`, `/elevated ask`, etc, we must preserve arguments.
    // So: when the message starts with a directive/command, pass the *full first line* to the command parser.
    // (OpenClaw will apply it as a directive-only message if the remaining body is empty.)
    return t.split("\n", 1)[0].trim();
  })();

  const commandAuthorized = true;
  const bodyForAgent = body;

  // Fetch files to temp (OpenClaw expects file paths, not data URLs)
  let mediaPaths: string[] | undefined;
  let mediaTypes: string[] | undefined;
  const fileCleanups: Array<() => Promise<void>> = [];
  
  if (fileRefs.length > 0) {
    const fetched = await Promise.all(
      fileRefs.map((ref) =>
        fetchFileToTemp(ref.url, authToken, userId, ref.mimeType, ref.fileName)
      )
    );
    const validFiles = fetched.filter((f): f is FetchedFile => f !== null);
    if (validFiles.length > 0) {
      mediaPaths = validFiles.map((f) => f.path);
      mediaTypes = validFiles.map((f) => f.mimeType);
      fileCleanups.push(...validFiles.map((f) => f.cleanup));
      logger.debug?.(`Fetched ${validFiles.length} file(s) from Rocket.Chat attachments`);
    }
  }

  const ctxPayload = core.channel?.reply?.finalizeInboundContext?.({
    Body: body,
    BodyForAgent: bodyForAgent,
    RawBody: rawBody,
    CommandBody: bodyForCommands,
    // Be explicit: directives (/model, /qwen, etc.) should be parsed from the raw inbound text.
    BodyForCommands: bodyForCommands,
    // Hint to OpenClaw that this is plain text (not a platform-native slash command).
    CommandSource: "text",

    // Allow inline directives like /model ...
    CommandAuthorized: commandAuthorized,

    From: isGroup ? `rocketchat:room:${roomId}` : `rocketchat:${senderId}`,
    To: `rocketchat:${roomId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName,
    SenderId: senderId,
    GroupSubject: isGroup ? roomName : undefined,
    Provider: "rocketchat",
    Surface: "rocketchat",
    MessageSid: msg._id,
    Timestamp: ts,
    OriginatingChannel: "rocketchat",
    OriginatingTo: `rocketchat:${roomId}`,

    // Image attachments (fetched to temp files)
    MediaPaths: mediaPaths?.length ? mediaPaths : undefined,
    MediaTypes: mediaTypes?.length ? mediaTypes : undefined,
  });

  if (!ctxPayload) {
    logger.error?.(`Failed to finalize inbound context for message ${msg._id}`);
    return;
  }
  // Record inbound session
  if (storePath) {
    await core.channel?.session?.recordInboundSession?.({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      onRecordError: (err) => {
        logger.error?.(`Failed updating session meta: ${String(err)}`);
      },
    });
  }

  // Dispatch to agent with reply handler
  // Typing indicator (mode B): only show if processing takes >N ms.
  const typingDelayMs = account.config.typingDelayMs ?? 1000;
  const typingPingMs = 4000;
  let typingTimer: NodeJS.Timeout | null = null;
  let typingInterval: NodeJS.Timeout | null = null;
  let typingStarted = false;

  async function setTyping(isTyping: boolean): Promise<void> {
    if (!setTypingFn) return;
    try {
      const meta = resolvedReplyMode === "thread" ? { tmid: msg.tmid ?? msg._id } : {};
      await setTypingFn(roomId, isTyping, meta);
    } catch (err) {
      // Non-fatal: some servers/clients may not support typing indicators.
      logger.debug?.(`Typing indicator failed: ${String(err)}`);
    }
  }

  function startTypingAfterDelay(): void {
    typingTimer = setTimeout(async () => {
      typingStarted = true;
      await setTyping(true);
      typingInterval = setInterval(() => {
        void setTyping(true);
      }, typingPingMs);
    }, typingDelayMs);
  }

  async function stopTyping(): Promise<void> {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
    if (typingStarted) {
      await setTyping(false);
    }
  }

  startTypingAfterDelay();

  try {
    // Wire up responsePrefix support (e.g. messages.responsePrefix: "({model}) ")
    // so Rocket.Chat replies can include the selected model name.
    const prefix = createReplyPrefixContext({ cfg, agentId: route.agentId });

    await core.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher?.({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        responsePrefix: prefix.responsePrefix,
        responsePrefixContextProvider: prefix.responsePrefixContextProvider,
        deliver: async (payload) => {
          const text = (payload as { text?: string }).text ?? "";
          if (!text.trim()) return;

          const replyToId = resolvedReplyMode === "thread" ? (msg.tmid ?? msg._id) : undefined;

          await sendMessageRocketChat(`room:${roomId}`, text, {
            accountId: account.accountId,
            replyToId,
          });
          statusSink?.({ lastOutboundAt: Date.now() });
        },
        onError: (err, info) => {
          logger.error?.(`Rocket.Chat ${info.kind} reply failed: ${String(err)}`);
        },
      },
      replyOptions: {
        onModelSelected: prefix.onModelSelected,
      },
    });
  } finally {
    await stopTyping();
    // Clean up temp files
    for (const cleanup of fileCleanups) {
      await cleanup();
    }
  }
}
