/**
 * Test cases for Rocket.Chat ACP conversation binding helpers.
 */

import assert from "node:assert";
import fs from "node:fs";

import {
  createRocketChatSessionBindingManager,
  resolveRocketChatBoundRoute,
} from "../src/rocketchat/session-bindings.js";
import {
  normalizeRocketChatConversationId,
  resolveRocketChatCommandConversation,
} from "../src/rocketchat/conversation-bindings.js";
import { createRocketChatReplyDeduper } from "../src/rocketchat/reply-dedupe.js";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("normalizes room ids from rocketchat targets", () => {
  assert.strictEqual(
    normalizeRocketChatConversationId("rocketchat:room:GENERAL"),
    "GENERAL"
  );
  assert.strictEqual(
    normalizeRocketChatConversationId("rocketchat:ByehQjC44FwMeiLbX"),
    "ByehQjC44FwMeiLbX"
  );
  assert.strictEqual(
    normalizeRocketChatConversationId("room:workflowdev"),
    "workflowdev"
  );
});

test("resolves current room conversation without a thread", () => {
  assert.deepStrictEqual(
    resolveRocketChatCommandConversation({
      originatingTo: "rocketchat:ByehQjC44FwMeiLbX",
    }),
    {
      conversationId: "ByehQjC44FwMeiLbX",
      parentConversationId: undefined,
    }
  );
});

test("resolves thread conversation with parent room", () => {
  assert.deepStrictEqual(
    resolveRocketChatCommandConversation({
      threadId: "thread-root-message-id",
      threadParentId: "room:ByehQjC44FwMeiLbX",
      originatingTo: "rocketchat:ByehQjC44FwMeiLbX",
    }),
    {
      conversationId: "thread-root-message-id",
      parentConversationId: "ByehQjC44FwMeiLbX",
    }
  );
});

test("plugin opts into current-conversation ACP bindings", () => {
  const channelSource = fs.readFileSync(
    new URL("../src/channel.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    channelSource.includes("supportsCurrentConversationBinding: true"),
    "src/channel.ts should opt Rocket.Chat into current-conversation ACP bindings"
  );
});

test("monitor forwards Rocket.Chat thread metadata into ACP context", () => {
  const monitorSource = fs.readFileSync(
    new URL("../src/rocketchat/monitor.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    monitorSource.includes("MessageThreadId: msg.tmid ?? undefined"),
    "src/rocketchat/monitor.ts should forward MessageThreadId for ACP command binding"
  );
  assert.ok(
    monitorSource.includes("ThreadParentId: msg.tmid ? roomId : undefined"),
    "src/rocketchat/monitor.ts should forward ThreadParentId for ACP command binding"
  );
});

test("session binding manager registers a current-placement adapter", async () => {
  const registered = [];
  const manager = createRocketChatSessionBindingManager({
    accountId: "default",
    idleTimeoutMs: 60000,
    maxAgeMs: 120000,
    registerSessionBindingAdapter: (adapter) => registered.push(adapter),
    unregisterSessionBindingAdapter: () => {},
  });

  assert.strictEqual(registered.length, 1);
  assert.deepStrictEqual(registered[0].capabilities, { placements: ["current"] });

  const record = await registered[0].bind({
    targetSessionKey: "acp:session-123",
    targetKind: "session",
    conversation: {
      channel: "rocketchat",
      accountId: "default",
      conversationId: "thread-root-message-id",
      parentConversationId: "ByehQjC44FwMeiLbX",
    },
    placement: "current",
    metadata: { label: "Codex thread" },
  });

  assert.ok(record);
  assert.strictEqual(record.conversation.conversationId, "thread-root-message-id");
  assert.strictEqual(record.conversation.parentConversationId, "ByehQjC44FwMeiLbX");
  assert.strictEqual(registered[0].resolveByConversation({
    channel: "rocketchat",
    accountId: "default",
    conversationId: "thread-root-message-id",
  }).targetSessionKey, "acp:session-123");

  const removed = await registered[0].unbind({
    bindingId: record.bindingId,
    reason: "test",
  });
  assert.strictEqual(removed.length, 1);
  assert.strictEqual(
    registered[0].resolveByConversation({
      channel: "rocketchat",
      accountId: "default",
      conversationId: "thread-root-message-id",
    }),
    null
  );

  manager.stop();
});

test("session binding manager refuses child placement", async () => {
  const registered = [];
  const manager = createRocketChatSessionBindingManager({
    accountId: "default",
    registerSessionBindingAdapter: (adapter) => registered.push(adapter),
    unregisterSessionBindingAdapter: () => {},
  });

  const result = await registered[0].bind({
    targetSessionKey: "acp:session-456",
    targetKind: "session",
    conversation: {
      channel: "rocketchat",
      accountId: "default",
      conversationId: "thread-root-message-id",
    },
    placement: "child",
    metadata: {},
  });

  assert.strictEqual(result, null);
  manager.stop();
});

test("bound route switches inbound delivery to the ACP session", async () => {
  const registered = [];
  const manager = createRocketChatSessionBindingManager({
    accountId: "default",
    registerSessionBindingAdapter: (adapter) => registered.push(adapter),
    unregisterSessionBindingAdapter: () => {},
  });

  await registered[0].bind({
    targetSessionKey: "acp:session-789",
    targetKind: "session",
    conversation: {
      channel: "rocketchat",
      accountId: "default",
      conversationId: "thread-root-message-id",
      parentConversationId: "ByehQjC44FwMeiLbX",
    },
    placement: "current",
    metadata: {},
  });

  const result = resolveRocketChatBoundRoute({
    route: {
      agentId: "main",
      sessionKey: "rocketchat:group:ByehQjC44FwMeiLbX",
    },
    bindingService: {
      resolveByConversation: registered[0].resolveByConversation,
    },
    accountId: "default",
    conversationId: "thread-root-message-id",
    parentConversationId: "ByehQjC44FwMeiLbX",
  });

  assert.strictEqual(result.route.sessionKey, "acp:session-789");
  assert.strictEqual(result.route.agentId, "acp");
  assert.strictEqual(result.route.matchedBy, "binding.channel");
  assert.ok(result.runtimeBindingId);

  manager.stop();
});

test("reply deduper suppresses identical repeated deliveries within one turn", () => {
  const deduper = createRocketChatReplyDeduper();

  assert.strictEqual(deduper.shouldDeliver("bound follow-up works"), true);
  assert.strictEqual(deduper.shouldDeliver("bound follow-up works"), false);
  assert.strictEqual(deduper.shouldDeliver("Session ids resolved."), true);
  assert.strictEqual(deduper.shouldDeliver("Session ids resolved."), false);
});

test("monitor currently uses buffered reply dispatch", () => {
  const monitorSource = fs.readFileSync(
    new URL("../src/rocketchat/monitor.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    monitorSource.includes("dispatchReplyWithBufferedBlockDispatcher?.({"),
    "src/rocketchat/monitor.ts should use the buffered reply dispatcher"
  );
});

test("monitor enables block streaming for Rocket.Chat by default", () => {
  const monitorSource = fs.readFileSync(
    new URL("../src/rocketchat/monitor.ts", import.meta.url),
    "utf8"
  );
  assert.ok(
    monitorSource.includes("disableBlockStreaming:"),
    "src/rocketchat/monitor.ts should set disableBlockStreaming explicitly"
  );
  assert.ok(
    monitorSource.includes(': false,'),
    "src/rocketchat/monitor.ts should default Rocket.Chat block streaming to enabled"
  );
});

console.log("Running Rocket.Chat conversation binding tests...\n");

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`   ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
