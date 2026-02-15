/**
 * Approval Command Parser
 * 
 * Parses commands like:
 * - approve @user123
 * - deny @user123
 * - approve room:GENERAL
 * - list pending
 * - pending
 */

export type ApprovalCommand = 
  | { action: "approve"; targets: string[] }
  | { action: "deny"; targets: string[] }
  | { action: "list" }
  | null;

/**
 * Parse an approval command from a message.
 * Returns null if the message is not a command.
 */
export function parseApprovalCommand(text: string): ApprovalCommand {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  
  // List commands
  if (lower === "list pending" || lower === "pending" || lower === "list") {
    return { action: "list" };
  }
  
  // Approve command
  const approveMatch = trimmed.match(/^approve\s+(.+)$/i);
  if (approveMatch) {
    const targets = parseTargets(approveMatch[1]);
    if (targets.length > 0) {
      return { action: "approve", targets };
    }
  }
  
  // Deny command
  const denyMatch = trimmed.match(/^deny\s+(.+)$/i);
  if (denyMatch) {
    const targets = parseTargets(denyMatch[1]);
    if (targets.length > 0) {
      return { action: "deny", targets };
    }
  }
  
  // Short forms: yes/no with target
  const yesMatch = trimmed.match(/^(yes|ok|y)\s+(.+)$/i);
  if (yesMatch) {
    const targets = parseTargets(yesMatch[2]);
    if (targets.length > 0) {
      return { action: "approve", targets };
    }
  }
  
  const noMatch = trimmed.match(/^(no|n|reject)\s+(.+)$/i);
  if (noMatch) {
    const targets = parseTargets(noMatch[2]);
    if (targets.length > 0) {
      return { action: "deny", targets };
    }
  }
  
  return null;
}

/**
 * Parse target identifiers from a string.
 * Supports: @username, room:NAME, user:ID, plain IDs
 * Supports multiple targets separated by spaces or commas.
 */
function parseTargets(input: string): string[] {
  // Split by comma or whitespace
  const parts = input.split(/[\s,]+/).filter(Boolean);
  
  const targets: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Already prefixed
    if (trimmed.startsWith("@") || trimmed.startsWith("room:") || trimmed.startsWith("user:")) {
      targets.push(trimmed);
      continue;
    }
    
    // Plain identifier - could be username or room
    targets.push(trimmed);
  }
  
  return targets;
}

/**
 * Format a pending approval for display.
 */
export function formatApprovalRequest(approval: {
  id: string;
  type: "dm" | "room";
  targetId: string;
  targetName?: string;
  targetUsername?: string;
  requesterName?: string;
  requesterUsername?: string;
  createdAt: number;
}): string {
  const age = formatAge(Date.now() - approval.createdAt);
  
  if (approval.type === "dm") {
    const who = approval.targetUsername 
      ? `@${approval.targetUsername}` 
      : approval.targetName ?? approval.targetId;
    return `• **DM** from ${who} (${age} ago) — \`approve ${approval.targetUsername ?? approval.targetId}\``;
  } else {
    const room = approval.targetName ?? approval.targetId;
    const who = approval.requesterUsername 
      ? `@${approval.requesterUsername}` 
      : approval.requesterName ?? "someone";
    return `• **Room** #${room} (invited by ${who}, ${age} ago) — \`approve room:${approval.targetId}\``;
  }
}

/**
 * Format age in human-readable form.
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Build the approval request notification message.
 */
export function buildApprovalRequestMessage(params: {
  type: "dm" | "room";
  targetId: string;
  targetName?: string;
  targetUsername?: string;
  requesterName?: string;
  requesterUsername?: string;
}): string {
  if (params.type === "dm") {
    const who = params.targetUsername 
      ? `@${params.targetUsername}` 
      : params.targetName ?? params.targetId;
    return [
      `🔔 **New DM request**`,
      ``,
      `User: ${who}`,
      ``,
      `Reply:`,
      `• \`approve ${params.targetUsername ?? params.targetId}\` — allow this user`,
      `• \`deny ${params.targetUsername ?? params.targetId}\` — block this user`,
      `• \`pending\` — list all pending requests`,
    ].join("\n");
  } else {
    const room = params.targetName ?? params.targetId;
    const who = params.requesterUsername 
      ? `@${params.requesterUsername}` 
      : params.requesterName ?? "Someone";
    return [
      `🔔 **Bot invited to new room**`,
      ``,
      `Room: #${room}`,
      `Invited by: ${who}`,
      ``,
      `Reply:`,
      `• \`approve room:${params.targetId}\` — allow this room`,
      `• \`deny room:${params.targetId}\` — leave this room`,
      `• \`pending\` — list all pending requests`,
    ].join("\n");
  }
}

/**
 * Build the "waiting for approval" message for requesters.
 */
export function buildWaitingMessage(): string {
  return `⏳ Your request is pending approval. The owner has been notified.`;
}

/**
 * Build the approval confirmation message.
 */
export function buildApprovedMessage(target: string, type: "dm" | "room"): string {
  if (type === "dm") {
    return `✅ You've been approved! You can now send messages.`;
  } else {
    return `✅ This room has been approved. I'm ready to help!`;
  }
}

/**
 * Build the denial message.
 */
export function buildDeniedMessage(target: string, type: "dm" | "room"): string {
  if (type === "dm") {
    return `❌ Your request was not approved.`;
  } else {
    return `❌ This room was not approved. Goodbye!`;
  }
}
