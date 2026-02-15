/**
 * Rocket.Chat message sending
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { resolveRocketChatAccount } from "./accounts.js";
import {
  createRocketChatClient,
  createRocketChatDirectMessage,
  fetchRocketChatChannelByName,
  fetchRocketChatMe,
  fetchRocketChatUserByUsername,
  normalizeRocketChatBaseUrl,
  postRocketChatMessage,
  reactRocketChatMessage,
  uploadRocketChatFile,
  type RocketChatUser,
} from "./client.js";
import { getRocketChatRuntime } from "../runtime.js";

export type RocketChatSendOpts = {
  accountId?: string;
  replyToId?: string;
  mediaUrl?: string;
};

export type RocketChatSendResult = {
  messageId: string;
  roomId: string;
};

type RocketChatTarget =
  | { kind: "room"; id: string }
  | { kind: "channel"; name: string }
  | { kind: "user"; username: string };

const botUserCache = new Map<string, RocketChatUser>();
const userByNameCache = new Map<string, RocketChatUser>();

function cacheKey(baseUrl: string, userId: string): string {
  return `${baseUrl}::${userId}`;
}

function normalizeMessage(text: string, mediaUrl?: string): string {
  const trimmed = text.trim();
  const media = mediaUrl?.trim();
  return [trimmed, media].filter(Boolean).join("\n");
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isLocalPath(value: string): boolean {
  // Check if it's an absolute path or relative path (not a URL)
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || /^[A-Za-z]:\\/.test(value);
}

/** Map file extensions to MIME types */
function getMimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  };
  return map[ext] ?? "application/octet-stream";
}

function parseRocketChatTarget(raw: string): RocketChatTarget {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Recipient is required for Rocket.Chat sends");

  const lower = trimmed.toLowerCase();

  // rocketchat:ID (OpenClaw sometimes uses this format)
  if (lower.startsWith("rocketchat:")) {
    const id = trimmed.slice("rocketchat:".length).trim();
    if (!id) throw new Error("Room id is required for Rocket.Chat sends");
    return { kind: "room", id };
  }

  // room:ID format
  if (lower.startsWith("room:")) {
    const id = trimmed.slice("room:".length).trim();
    if (!id) throw new Error("Room id is required for Rocket.Chat sends");
    return { kind: "room", id };
  }

  // #channel format
  if (trimmed.startsWith("#")) {
    const name = trimmed.slice(1).trim();
    if (!name) throw new Error("Channel name is required for Rocket.Chat sends");
    return { kind: "channel", name };
  }

  // @username format
  if (trimmed.startsWith("@")) {
    const username = trimmed.slice(1).trim();
    if (!username) throw new Error("Username is required for Rocket.Chat sends");
    return { kind: "user", username };
  }

  // user:username format
  if (lower.startsWith("user:")) {
    const username = trimmed.slice("user:".length).trim();
    if (!username) throw new Error("Username is required for Rocket.Chat sends");
    return { kind: "user", username };
  }

  // Default to channel name (could also be room ID)
  // Room IDs vary by deployment; commonly 17-char tokens or 24-char Mongo ObjectIds, but allow growth.
  if (trimmed.includes("/") || /^[A-Za-z0-9]{17,64}$/.test(trimmed)) {
    return { kind: "room", id: trimmed };
  }

  return { kind: "channel", name: trimmed };
}

async function resolveTargetRoomId(params: {
  target: RocketChatTarget;
  baseUrl: string;
  userId: string;
  authToken: string;
}): Promise<string> {
  const client = createRocketChatClient({
    baseUrl: params.baseUrl,
    userId: params.userId,
    authToken: params.authToken,
  });

  if (params.target.kind === "room") {
    return params.target.id;
  }

  if (params.target.kind === "channel") {
    // For channels, we can use the channel name directly with postMessage
    return `#${params.target.name}`;
  }

  if (params.target.kind === "user") {
    // Create or get DM room
    const dm = await createRocketChatDirectMessage(client, params.target.username);
    return dm.rid;
  }

  throw new Error("Unknown target kind");
}

export async function sendMessageRocketChat(
  to: string,
  text: string,
  opts: RocketChatSendOpts = {}
): Promise<RocketChatSendResult> {
  const core = getRocketChatRuntime();
  const logger = core?.logging?.getChildLogger?.({ module: "rocketchat" });
  const cfg = core?.config?.loadConfig?.() ?? {};

  const account = resolveRocketChatAccount({ cfg, accountId: opts.accountId });
  
  const authToken = account.authToken?.trim();
  if (!authToken) {
    throw new Error(
      `Rocket.Chat authToken missing for account "${account.accountId}"`
    );
  }

  const userId = account.userId?.trim();
  if (!userId) {
    throw new Error(
      `Rocket.Chat userId missing for account "${account.accountId}"`
    );
  }

  const baseUrl = normalizeRocketChatBaseUrl(account.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `Rocket.Chat baseUrl missing for account "${account.accountId}"`
    );
  }

  const target = parseRocketChatTarget(to);
  const roomId = await resolveTargetRoomId({
    target,
    baseUrl,
    userId,
    authToken,
  });

  const client = createRocketChatClient({ baseUrl, userId, authToken });

  let message = text?.trim() ?? "";
  const mediaUrl = opts.mediaUrl?.trim();

  // Resolve actual room ID for uploads (channels need to be looked up)
  const isChannel = target.kind === "channel";
  let uploadRoomId = roomId;
  
  if (isChannel && mediaUrl && isLocalPath(mediaUrl)) {
    // For channel uploads, we need the actual room _id, not the #name
    const channelInfo = await fetchRocketChatChannelByName(client, target.name);
    if (channelInfo?._id) {
      uploadRoomId = channelInfo._id;
      logger?.debug?.(`Resolved channel "${target.name}" to room ID: ${uploadRoomId}`);
    } else {
      logger?.warn?.(`Could not resolve channel "${target.name}" to room ID, upload may fail`);
    }
  }

  // Handle local file uploads
  if (mediaUrl && isLocalPath(mediaUrl)) {
    try {
      const fileBuffer = await fs.readFile(mediaUrl);
      const fileName = path.basename(mediaUrl);
      const mimeType = getMimeFromExt(mediaUrl);
      
      logger?.debug?.(`Uploading file to Rocket.Chat: ${fileName} (${mimeType}, ${fileBuffer.length} bytes) to room ${uploadRoomId}`);
      
      const upload = await uploadRocketChatFile(client, {
        roomId: uploadRoomId,
        file: fileBuffer,
        fileName,
        mimeType,
        description: message || undefined,
        tmid: opts.replyToId,
      });
      
      core?.channel?.activity?.record?.({
        channel: "rocketchat",
        accountId: account.accountId,
        direction: "outbound",
      });
      
      return {
        messageId: upload._id ?? "unknown",
        roomId: upload.rid ?? uploadRoomId,
      };
    } catch (err) {
      logger?.error?.(`Failed to upload file to Rocket.Chat: ${String(err)}`);
      // Fall through to send as text message with path (degraded experience)
      message = normalizeMessage(message, `[File: ${mediaUrl}]`);
    }
  }

  // For HTTP URLs, append to message (Rocket.Chat will unfurl)
  if (mediaUrl && isHttpUrl(mediaUrl)) {
    message = normalizeMessage(message, mediaUrl);
  }

  if (!message) {
    throw new Error("Rocket.Chat message is empty");
  }

  const post = await postRocketChatMessage(client, {
    roomId: isChannel ? undefined : roomId,
    channel: isChannel ? `#${target.name}` : undefined,
    text: message,
    tmid: opts.replyToId,
  });

  core?.channel?.activity?.record?.({
    channel: "rocketchat",
    accountId: account.accountId,
    direction: "outbound",
  });

  return {
    messageId: post._id ?? "unknown",
    roomId: post.rid ?? roomId,
  };
}

export type RocketChatReactOpts = {
  accountId?: string;
  shouldReact?: boolean;
};

/**
 * React to a Rocket.Chat message with an emoji.
 * @param messageId - The message ID to react to
 * @param emoji - Emoji name (e.g., "thumbsup", ":rocket:", "🚀")
 */
export async function reactMessageRocketChat(
  messageId: string,
  emoji: string,
  opts: RocketChatReactOpts = {}
): Promise<void> {
  const core = getRocketChatRuntime();
  const logger = core?.logging?.getChildLogger?.({ module: "rocketchat" });
  const cfg = core?.config?.loadConfig?.() ?? {};

  const account = resolveRocketChatAccount({ cfg, accountId: opts.accountId });

  const authToken = account.authToken?.trim();
  if (!authToken) {
    throw new Error(
      `Rocket.Chat authToken missing for account "${account.accountId}"`
    );
  }

  const userId = account.userId?.trim();
  if (!userId) {
    throw new Error(
      `Rocket.Chat userId missing for account "${account.accountId}"`
    );
  }

  const baseUrl = normalizeRocketChatBaseUrl(account.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `Rocket.Chat baseUrl missing for account "${account.accountId}"`
    );
  }

  const client = createRocketChatClient({ baseUrl, userId, authToken });

  logger?.debug?.(`Reacting to message ${messageId} with ${emoji}`);

  await reactRocketChatMessage(client, messageId, emoji, opts.shouldReact ?? true);

  core?.channel?.activity?.record?.({
    channel: "rocketchat",
    accountId: account.accountId,
    direction: "outbound",
  });
}
