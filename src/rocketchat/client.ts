/**
 * Rocket.Chat REST API client
 */

export type RocketChatClient = {
  baseUrl: string;
  userId: string;
  authToken: string;
  fetch: typeof fetch;
};

export type RocketChatUser = {
  _id: string;
  username: string;
  name?: string;
  status?: string;
};

export type RocketChatRoom = {
  _id: string;
  name?: string;
  fname?: string;
  t: "c" | "p" | "d" | "l"; // channel, private, direct, livechat
  usernames?: string[];
  usersCount?: number;
  msgs?: number;
  default?: boolean;
  topic?: string;
};

export type RocketChatMessage = {
  _id: string;
  rid: string;
  msg: string;
  ts: string;
  u: RocketChatUser;
  _updatedAt: string;
  mentions?: RocketChatUser[];
  channels?: { _id: string; name: string }[];
  attachments?: RocketChatAttachment[];
  tmid?: string; // thread message id
  t?: string; // system message type
};

export type RocketChatAttachment = {
  title?: string;
  title_link?: string;
  image_url?: string;
  audio_url?: string;
  video_url?: string;
  type?: string;
};

export function createRocketChatClient(opts: {
  baseUrl: string;
  userId: string;
  authToken: string;
}): RocketChatClient {
  const baseUrl = normalizeRocketChatBaseUrl(opts.baseUrl);
  if (!baseUrl) throw new Error("Invalid Rocket.Chat baseUrl");
  return {
    baseUrl,
    userId: opts.userId,
    authToken: opts.authToken,
    fetch: globalThis.fetch,
  };
}

export function normalizeRocketChatBaseUrl(url?: string): string | null {
  if (!url) return null;
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

async function rcFetch<T>(
  client: RocketChatClient,
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const url = `${client.baseUrl}${path}`;
  const headers: Record<string, string> = {
    "X-Auth-Token": client.authToken,
    "X-User-Id": client.userId,
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> ?? {}),
  };
  const res = await client.fetch(url, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Rocket.Chat API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchRocketChatMe(client: RocketChatClient): Promise<RocketChatUser> {
  const res = await rcFetch<{ _id: string; username: string; name?: string; success: boolean }>(
    client,
    "/api/v1/me"
  );
  return { _id: res._id, username: res.username, name: res.name };
}

export async function fetchRocketChatUser(
  client: RocketChatClient,
  userId: string
): Promise<RocketChatUser> {
  const res = await rcFetch<{ user: RocketChatUser; success: boolean }>(
    client,
    `/api/v1/users.info?userId=${encodeURIComponent(userId)}`
  );
  return res.user;
}

export async function fetchRocketChatUserByUsername(
  client: RocketChatClient,
  username: string
): Promise<RocketChatUser> {
  const res = await rcFetch<{ user: RocketChatUser; success: boolean }>(
    client,
    `/api/v1/users.info?username=${encodeURIComponent(username)}`
  );
  return res.user;
}

export async function fetchRocketChatRoom(
  client: RocketChatClient,
  roomId: string
): Promise<RocketChatRoom> {
  const res = await rcFetch<{ room: RocketChatRoom; success: boolean }>(
    client,
    `/api/v1/rooms.info?roomId=${encodeURIComponent(roomId)}`
  );
  return res.room;
}

export async function fetchRocketChatChannels(
  client: RocketChatClient
): Promise<RocketChatRoom[]> {
  const res = await rcFetch<{ channels: RocketChatRoom[]; success: boolean }>(
    client,
    "/api/v1/channels.list.joined"
  );
  return res.channels;
}

export type RocketChatSubscription = {
  _id: string;
  rid: string;
  name: string;
  fname?: string;
  t: "c" | "p" | "d" | "l";
  open?: boolean;
};

export async function fetchRocketChatSubscriptions(
  client: RocketChatClient
): Promise<RocketChatSubscription[]> {
  const res = await rcFetch<{ update: RocketChatSubscription[]; success: boolean }>(
    client,
    "/api/v1/subscriptions.get"
  );
  return res.update ?? [];
}

export async function createRocketChatDirectMessage(
  client: RocketChatClient,
  username: string
): Promise<{ rid: string }> {
  const res = await rcFetch<{ room: { rid: string }; success: boolean }>(
    client,
    "/api/v1/im.create",
    {
      method: "POST",
      body: JSON.stringify({ username }),
    }
  );
  return { rid: res.room.rid };
}

export async function postRocketChatMessage(
  client: RocketChatClient,
  opts: {
    roomId?: string;
    channel?: string;
    text: string;
    tmid?: string;
    attachments?: RocketChatAttachment[];
  }
): Promise<RocketChatMessage> {
  const payload: Record<string, unknown> = {
    text: opts.text,
  };
  if (opts.roomId) payload.roomId = opts.roomId;
  if (opts.channel) payload.channel = opts.channel;
  if (opts.tmid) payload.tmid = opts.tmid;
  if (opts.attachments) payload.attachments = opts.attachments;

  const res = await rcFetch<{ message: RocketChatMessage; success: boolean }>(
    client,
    "/api/v1/chat.postMessage",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  return res.message;
}

export async function sendRocketChatTyping(
  client: RocketChatClient,
  roomId: string,
  isTyping: boolean
): Promise<void> {
  // Rocket.Chat exposes a REST endpoint for typing state in most deployments.
  // If the server doesn't support it (or it changes), callers should treat
  // failures as non-fatal.
  await rcFetch<{ success: boolean }>(client, "/api/v1/typing", {
    method: "POST",
    body: JSON.stringify({ roomId, typing: Boolean(isTyping) }),
  });
}
