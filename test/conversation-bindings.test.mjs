/**
 * Test cases for Rocket.Chat ACP conversation binding helpers.
 */

import assert from "node:assert";
import fs from "node:fs";

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
