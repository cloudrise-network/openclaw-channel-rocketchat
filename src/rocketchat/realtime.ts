/**
 * Rocket.Chat Realtime API (DDP/WebSocket) client
 * 
 * Rocket.Chat uses DDP (Distributed Data Protocol) over WebSocket for realtime
 * features like message streaming, typing indicators, and presence.
 */

import WebSocket from "ws";

export type DDPMessage = {
  msg: string;
  id?: string;
  method?: string;
  params?: unknown[];
  result?: unknown;
  error?: { error: string; message: string };
  collection?: string;
  fields?: Record<string, unknown>;
  session?: string;
  subs?: string[];
};

export type RealtimeOpts = {
  baseUrl: string;
  userId: string;
  authToken: string;
  onMessage?: (msg: IncomingMessage) => void;
  /** Low-level notification stream (stream-notify-user / stream-notify-room, etc). */
  onNotify?: (evt: { collection: string; eventName?: string; args?: unknown[] }) => void;
  onConnect?: () => void;
  onDisconnect?: (reason?: string) => void;
  onError?: (error: Error) => void;
  logger?: { debug?: (msg: string) => void; info?: (msg: string) => void };
};

export type RocketChatAttachment = {
  title?: string;
  title_link?: string;
  image_url?: string;
  audio_url?: string;
  video_url?: string;
  type?: string;
  image_type?: string;
  image_size?: number;
};

export type RocketChatFile = {
  _id: string;
  name: string;
  type?: string;
  size?: number;
};

export type IncomingMessage = {
  _id: string;
  rid: string;
  msg: string;
  ts: { $date: number } | string;
  u: { _id: string; username: string; name?: string };
  tmid?: string;
  t?: string;
  attachments?: RocketChatAttachment[];
  file?: RocketChatFile;
  files?: RocketChatFile[];
};

export class RocketChatRealtime {
  private ws: WebSocket | null = null;
  private opts: RealtimeOpts;
  private messageId = 0;
  private pendingCalls = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  // Desired room subscriptions survive reconnects.
  private desiredRoomIds = new Set<string>();
  // Subscription ids are per-connection; re-created on each reconnect.
  private activeSubIdsByRoom = new Map<string, string>();

  private subscriptions = new Map<string, string>();
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;
  private shouldReconnect = true;
  private reconnectDelayMs = 5_000;
  private readonly reconnectMaxDelayMs = 60_000;

  constructor(opts: RealtimeOpts) {
    this.opts = opts;
  }

  private getWsUrl(): string {
    const base = this.opts.baseUrl.replace(/^http/, "ws");
    return `${base}/websocket`;
  }

  private nextId(): string {
    return String(++this.messageId);
  }

  private send(msg: DDPMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.getWsUrl();
      this.opts.logger?.debug?.(`Connecting to ${wsUrl}`);

      // Reset per-connection state.
      this.isConnected = false;
      this.activeSubIdsByRoom.clear();

      // Create a new socket.
      this.ws = new WebSocket(wsUrl);

      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const rejectOnce = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      this.ws.on("open", () => {
        // Send DDP connect message
        this.send({ msg: "connect", version: "1", support: ["1"] } as unknown as DDPMessage);
      });

      this.ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString()) as DDPMessage;
          await this.handleMessage(msg, resolveOnce);
        } catch (err) {
          this.opts.logger?.debug?.(`Failed to parse message: ${err}`);
        }
      });

      this.ws.on("close", (_code, reason) => {
        const reasonStr = reason?.toString();

        // If we never fully connected, fail the connect() call so callers can react.
        if (!this.isConnected) {
          rejectOnce(new Error(reasonStr || "WebSocket closed before DDP connected"));
        }

        this.isConnected = false;
        this.opts.onDisconnect?.(reasonStr);

        this.stopPing();
        this.rejectAllPending(new Error(reasonStr || "Disconnected"));

        // Clear socket reference.
        this.ws = null;

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (err) => {
        this.opts.onError?.(err);
        // If we haven't connected yet, fail connect(); otherwise close handler will schedule reconnect.
        if (!this.isConnected) {
          rejectOnce(err);
        }
      });
    });
  }

  private async handleMessage(msg: DDPMessage, onConnected?: (value: void) => void): Promise<void> {
    switch (msg.msg) {
      case "connected":
        this.opts.logger?.debug?.("DDP connected, logging in...");
        await this.login();

        this.isConnected = true;
        // Reset reconnect delay after a successful connection.
        this.reconnectDelayMs = 5_000;

        this.startPing();

        // Re-subscribe to desired rooms after login.
        await this.resubscribeAll().catch((err) => {
          this.opts.logger?.debug?.(`Resubscribe failed: ${String(err)}`);
        });

        this.opts.onConnect?.();
        onConnected?.();
        break;

      case "result":
        if (msg.id) {
          const pending = this.pendingCalls.get(msg.id);
          if (pending) {
            this.pendingCalls.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
        break;

      case "changed": {
        if (msg.collection === "stream-room-messages") {
          const fields = msg.fields as { args?: IncomingMessage[] };
          const messages = fields?.args ?? [];
          for (const m of messages) {
            // Skip system messages
            if (m.t) continue;
            this.opts.onMessage?.(m);
          }
          break;
        }

        // Other stream notifications
        if (msg.collection && msg.fields) {
          const fields = msg.fields as { eventName?: string; args?: unknown[] };
          if (fields?.eventName || fields?.args) {
            this.opts.onNotify?.({
              collection: msg.collection,
              eventName: fields.eventName,
              args: fields.args,
            });
          }
        }

        break;
      }

      case "ping":
        this.send({ msg: "pong" });
        break;

      case "pong":
        // Response to our ping, connection is alive
        break;

      case "ready":
        // Subscription is ready
        this.opts.logger?.debug?.(`Subscription ready: ${msg.subs?.join(", ")}`);
        break;

      case "nosub":
        this.opts.logger?.debug?.(`Subscription failed: ${msg.id}`);
        break;
    }
  }

  private async login(): Promise<void> {
    await this.callMethod("login", [{ resume: this.opts.authToken }]);
  }

  async callMethod(method: string, params: unknown[] = []): Promise<unknown> {
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pendingCalls.set(id, { resolve, reject });
      this.send({
        msg: "method",
        method,
        id,
        params,
      });
    });
  }

  async subscribeToRoom(roomId: string): Promise<void> {
    const trimmed = roomId.trim();
    if (!trimmed) return;

    // Always remember desired subscriptions so they survive reconnects.
    this.desiredRoomIds.add(trimmed);

    // If we're not connected yet (or socket isn't open), we'll subscribe on connect.
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) return;

    // Avoid duplicate sub messages for this connection.
    if (this.activeSubIdsByRoom.has(trimmed)) return;

    const id = this.nextId();
    this.activeSubIdsByRoom.set(trimmed, id);

    this.opts.logger?.debug?.(`Subscribing to room: ${trimmed} with sub id: ${id}`);

    this.send({
      msg: "sub",
      id,
      name: "stream-room-messages",
      params: [trimmed, false],
    } as unknown as DDPMessage);
  }

  async subscribeToRooms(roomIds: string[]): Promise<void> {
    for (const roomId of roomIds) {
      await this.subscribeToRoom(roomId);
    }
  }

  async subscribeToUserEvent(eventName: string): Promise<void> {
    const key = `user:${eventName}`;
    if (this.subscriptions.has(key)) return;

    const id = this.nextId();
    this.subscriptions.set(key, id);

    this.opts.logger?.debug?.(`Subscribing to user event: ${eventName} with sub id: ${id}`);

    this.send({
      msg: "sub",
      id,
      name: "stream-notify-user",
      params: [eventName, false],
    } as unknown as DDPMessage);
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ msg: "ping" });
    }, 25000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    const delay = Math.min(this.reconnectDelayMs, this.reconnectMaxDelayMs);
    this.opts.logger?.debug?.(`Scheduling reconnect in ${Math.round(delay / 1000)}s...`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect().catch((err) => {
        // If connect fails, keep retrying (up to 60s cadence).
        this.opts.onError?.(err);
        if (this.shouldReconnect) this.scheduleReconnect();
      });
    }, delay);

    // Backoff to a max of 60s.
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.reconnectMaxDelayMs);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();
    this.rejectAllPending(new Error("Disconnected"));
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pendingCalls) {
      try {
        pending.reject(err);
      } catch {
        // ignore
      }
    }
    this.pendingCalls.clear();
  }

  private async resubscribeAll(): Promise<void> {
    if (!this.isConnected) return;

    // Reset per-connection subscription tracking.
    this.activeSubIdsByRoom.clear();

    const rooms = Array.from(this.desiredRoomIds);
    if (rooms.length) {
      this.opts.logger?.debug?.(`Re-subscribing to ${rooms.length} rooms...`);
    }

    for (const rid of rooms) {
      await this.subscribeToRoom(rid);
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
