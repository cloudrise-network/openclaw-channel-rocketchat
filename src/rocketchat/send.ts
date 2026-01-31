/**
 * Rocket.Chat message sending
 */

import { resolveRocketChatAccount } from "./accounts.js";
import {
  createRocketChatClient,
  createRocketChatDirectMessage,
  fetchRocketChatMe,
  fetchRocketChatUserByUsername,
  normalizeRocketChatBaseUrl,
  postRocketChatMessage,
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

function parseRocketChatTarget(raw: string): RocketChatTarget {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Recipient is required for Rocket.Chat sends");

  const lower = trimmed.toLowerCase();

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
  if (trimmed.includes("/") || /^[A-Za-z0-9]{17}$/.test(trimmed)) {
    // Looks like a room ID
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

  // For media, we just append the URL since Rocket.Chat will unfurl it
  if (mediaUrl && isHttpUrl(mediaUrl)) {
    message = normalizeMessage(message, mediaUrl);
  }

  if (!message) {
    throw new Error("Rocket.Chat message is empty");
  }

  const isChannel = target.kind === "channel";
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
