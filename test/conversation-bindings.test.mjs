/**
 * Test cases for Rocket.Chat ACP conversation binding helpers.
 */

import assert from "node:assert";
import fs from "node:fs";

import {
  createRocketChatSessionBindingManager,
} from "../src/rocketchat/session-bindings.js";
import {
  normalizeRocketChatConversationId,
  resolveRocketChatCommandConversation,
} from "../src/rocketchat/conversation-bindings.js";

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
