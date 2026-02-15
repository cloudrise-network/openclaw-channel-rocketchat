/**
 * Pairing store for Rocket.Chat channel plugin
 * 
 * Implements OpenClaw-compatible pairing using the same file format
 * so `openclaw pairing list/approve rocketchat` commands work.
 * 
 * State is stored in ~/.openclaw/credentials/:
 * - rocketchat-pairing.json (pending requests)
 * - rocketchat-allowFrom.json (approved users)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

const CHANNEL_ID = "rocketchat";
const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No 0O1I
const PAIRING_TTL_MS = 3600 * 1000; // 1 hour
const MAX_PENDING = 3;

type PairingRequest = {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string | undefined>;
};

type PairingStore = {
  version: number;
  requests: PairingRequest[];
};

type AllowFromStore = {
  version: number;
  entries: string[];
};

function resolveCredentialsDir(): string {
  return path.join(os.homedir(), ".openclaw", "credentials");
}

function resolvePairingPath(): string {
  return path.join(resolveCredentialsDir(), `${CHANNEL_ID}-pairing.json`);
}

function resolveAllowFromPath(storeId: string = CHANNEL_ID): string {
  return path.join(resolveCredentialsDir(), `${storeId}-allowFrom.json`);
}

function generatePairingCode(): string {
  const bytes = crypto.randomBytes(PAIRING_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
}

async function readPairingStore(): Promise<PairingStore> {
  try {
    const data = await fs.readFile(resolvePairingPath(), "utf-8");
    const parsed = JSON.parse(data);
    return {
      version: parsed.version ?? 1,
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
    };
  } catch {
    return { version: 1, requests: [] };
  }
}

async function writePairingStore(store: PairingStore): Promise<void> {
  await ensureDir(resolveCredentialsDir());
  const filePath = resolvePairingPath();
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
}

async function readAllowFromStore(storeId: string = CHANNEL_ID): Promise<AllowFromStore> {
  try {
    const data = await fs.readFile(resolveAllowFromPath(storeId), "utf-8");
    const parsed = JSON.parse(data);
    return {
      version: parsed.version ?? 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeAllowFromStore(store: AllowFromStore, storeId: string = CHANNEL_ID): Promise<void> {
  await ensureDir(resolveCredentialsDir());
  const filePath = resolveAllowFromPath(storeId);
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
}

/**
 * Read the allowFrom list from the pairing store.
 * @param storeId - Store identifier (default: "rocketchat", use "rocketchat-rooms" for room allowlist)
 */
export async function readChannelAllowFromStore(storeId: string = CHANNEL_ID): Promise<string[]> {
  const store = await readAllowFromStore(storeId);
  return store.entries;
}

/**
 * Create or update a pairing request.
 * Returns the pairing code and whether a new request was created.
 */
export async function upsertChannelPairingRequest(params: {
  id: string;
  meta?: Record<string, string | undefined>;
}): Promise<{ code: string; created: boolean }> {
  const store = await readPairingStore();
  const now = new Date().toISOString();
  const cutoff = Date.now() - PAIRING_TTL_MS;

  // Remove expired requests
  store.requests = store.requests.filter(
    (r) => new Date(r.createdAt).getTime() > cutoff
  );

  // Check for existing request
  const existing = store.requests.find((r) => r.id === params.id);
  if (existing) {
    existing.lastSeenAt = now;
    if (params.meta) {
      existing.meta = { ...existing.meta, ...params.meta };
    }
    await writePairingStore(store);
    return { code: existing.code, created: false };
  }

  // Limit pending requests
  if (store.requests.length >= MAX_PENDING) {
    // Remove oldest request
    store.requests.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    store.requests.shift();
  }

  // Create new request
  const code = generatePairingCode();
  const cleanMeta: Record<string, string> = {};
  if (params.meta) {
    for (const [k, v] of Object.entries(params.meta)) {
      if (v !== undefined && v !== null) {
        cleanMeta[k] = v;
      }
    }
  }

  store.requests.push({
    id: params.id,
    code,
    createdAt: now,
    lastSeenAt: now,
    meta: Object.keys(cleanMeta).length > 0 ? cleanMeta : undefined,
  });

  await writePairingStore(store);
  return { code, created: true };
}

/**
 * Build the standard OpenClaw pairing reply message.
 */
export function buildPairingReply(params: {
  idLine: string;
  code: string;
}): string {
  return [
    "🔐 **Pairing required**",
    "",
    params.idLine,
    "",
    `Your pairing code: \`${params.code}\``,
    "",
    `Ask the owner to approve: \`openclaw pairing approve ${CHANNEL_ID} ${params.code}\``,
  ].join("\n");
}

/**
 * Add an entry to the allowFrom store (called when pairing is approved).
 * @param entry - The entry to add (user ID or room ID)
 * @param storeId - Store identifier (default: "rocketchat", use "rocketchat-rooms" for room allowlist)
 */
export async function addToAllowFrom(entry: string, storeId: string = CHANNEL_ID): Promise<void> {
  const store = await readAllowFromStore(storeId);
  const normalized = entry.toLowerCase().trim();
  if (!store.entries.includes(normalized)) {
    store.entries.push(normalized);
    await writeAllowFromStore(store, storeId);
  }
}
