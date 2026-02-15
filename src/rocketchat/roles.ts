/**
 * Rocket.Chat Role Checker
 * 
 * Fetches and checks user roles via the Rocket.Chat API.
 */

import type { RocketChatClient } from "./client.js";

export type UserRoles = {
  userId: string;
  username?: string;
  roles: string[];
};

// Cache user roles for 5 minutes
const roleCache = new Map<string, { roles: UserRoles; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch user info by username from Rocket.Chat.
 */
export async function fetchUserByUsername(
  client: RocketChatClient,
  username: string
): Promise<UserRoles | null> {
  try {
    const response = await fetch(`${client.baseUrl}/api/v1/users.info?username=${encodeURIComponent(username)}`, {
      headers: {
        "X-Auth-Token": client.authToken,
        "X-User-Id": client.userId,
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    const user = data.user;
    
    if (!user) return null;
    
    return {
      userId: user._id,
      username: user.username,
      roles: Array.isArray(user.roles) ? user.roles : [],
    };
  } catch {
    return null;
  }
}

/**
 * Fetch user info including roles from Rocket.Chat.
 */
export async function fetchUserRoles(
  client: RocketChatClient,
  userId: string
): Promise<UserRoles | null> {
  // Check cache
  const cached = roleCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.roles;
  }
  
  try {
    const response = await fetch(`${client.baseUrl}/api/v1/users.info?userId=${encodeURIComponent(userId)}`, {
      headers: {
        "X-Auth-Token": client.authToken,
        "X-User-Id": client.userId,
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    const user = data.user;
    
    if (!user) return null;
    
    const roles: UserRoles = {
      userId: user._id,
      username: user.username,
      roles: Array.isArray(user.roles) ? user.roles : [],
    };
    
    // Cache the result
    roleCache.set(userId, { roles, fetchedAt: Date.now() });
    
    return roles;
  } catch {
    return null;
  }
}

/**
 * Check if a user matches any of the approver patterns.
 * 
 * Patterns:
 * - @username — matches specific username
 * - role:admin — matches anyone with "admin" role
 * - role:moderator — matches anyone with "moderator" role
 * - userId — matches specific user ID
 */
export async function isApprover(
  client: RocketChatClient,
  userId: string,
  username: string | undefined,
  approverPatterns: string[]
): Promise<boolean> {
  if (approverPatterns.length === 0) return false;
  
  const normalizedUsername = username?.toLowerCase();
  
  // Check each pattern
  for (const pattern of approverPatterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    
    // @username match
    if (trimmed.startsWith("@")) {
      const targetUsername = trimmed.slice(1).toLowerCase();
      if (normalizedUsername === targetUsername) {
        return true;
      }
      continue;
    }
    
    // role:xxx match
    if (trimmed.startsWith("role:")) {
      const targetRole = trimmed.slice(5).toLowerCase();
      const userRoles = await fetchUserRoles(client, userId);
      if (userRoles?.roles.some(r => r.toLowerCase() === targetRole)) {
        return true;
      }
      continue;
    }
    
    // Direct user ID match
    if (trimmed === userId) {
      return true;
    }
    
    // Username without @ prefix
    if (normalizedUsername === trimmed.toLowerCase()) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a room/channel is in the notify channels list.
 */
export function isNotifyChannel(
  roomId: string,
  roomName: string | undefined,
  notifyChannels: string[]
): boolean {
  if (notifyChannels.length === 0) return false;
  
  const normalizedName = roomName?.toLowerCase();
  
  for (const channel of notifyChannels) {
    const trimmed = channel.trim();
    if (!trimmed) continue;
    
    // @username (DM) — we check this separately
    if (trimmed.startsWith("@")) {
      continue;
    }
    
    // room:ID or room:NAME
    if (trimmed.startsWith("room:")) {
      const target = trimmed.slice(5);
      if (target === roomId) return true;
      if (normalizedName && target.toLowerCase() === normalizedName) return true;
      continue;
    }
    
    // #channel
    if (trimmed.startsWith("#")) {
      const target = trimmed.slice(1).toLowerCase();
      if (normalizedName === target) return true;
      continue;
    }
    
    // Plain room ID or name
    if (trimmed === roomId) return true;
    if (normalizedName && trimmed.toLowerCase() === normalizedName) return true;
  }
  
  return false;
}

/**
 * Get DM targets from notify channels.
 * Returns usernames (without @) that should receive DM notifications.
 */
export function getDmNotifyTargets(notifyChannels: string[]): string[] {
  const targets: string[] = [];
  
  for (const channel of notifyChannels) {
    const trimmed = channel.trim();
    if (trimmed.startsWith("@")) {
      targets.push(trimmed.slice(1));
    }
  }
  
  return targets;
}

/**
 * Clear the role cache (useful for testing or when roles change).
 */
export function clearRoleCache(): void {
  roleCache.clear();
}
