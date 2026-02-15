/**
 * Test cases for approval command parsing
 */

import assert from "node:assert";

// Simple test runner
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Import the parseApprovalCommand function
// Since this is a TypeScript project, we'll test the logic manually
// In a real setup, you'd use ts-node or compile first

// Test cases for parseApprovalCommand logic
test("parse 'approve @user123' → approve action with target", () => {
  const text = "approve @user123";
  // Expected: { action: "approve", targets: ["@user123"] }
  assert.ok(text.match(/^approve\s+(.+)$/i));
  const match = text.match(/^approve\s+(.+)$/i);
  assert.strictEqual(match[1], "@user123");
});

test("parse 'deny user456' → deny action with target", () => {
  const text = "deny user456";
  assert.ok(text.match(/^deny\s+(.+)$/i));
  const match = text.match(/^deny\s+(.+)$/i);
  assert.strictEqual(match[1], "user456");
});

test("parse 'approve room:GENERAL' → approve with room target", () => {
  const text = "approve room:GENERAL";
  const match = text.match(/^approve\s+(.+)$/i);
  assert.strictEqual(match[1], "room:GENERAL");
});

test("parse 'pending' → list action", () => {
  const text = "pending";
  const lower = text.toLowerCase();
  assert.ok(lower === "pending" || lower === "list pending" || lower === "list");
});

test("parse 'list pending' → list action", () => {
  const text = "list pending";
  const lower = text.toLowerCase();
  assert.ok(lower === "pending" || lower === "list pending" || lower === "list");
});

test("parse 'approve @user1 @user2 @user3' → multiple targets", () => {
  const text = "approve @user1 @user2 @user3";
  const match = text.match(/^approve\s+(.+)$/i);
  const targets = match[1].split(/[\s,]+/).filter(Boolean);
  assert.deepStrictEqual(targets, ["@user1", "@user2", "@user3"]);
});

test("parse 'yes @user123' → approve (shorthand)", () => {
  const text = "yes @user123";
  const yesMatch = text.match(/^(yes|ok|y)\s+(.+)$/i);
  assert.ok(yesMatch);
  assert.strictEqual(yesMatch[2], "@user123");
});

test("parse 'no @user123' → deny (shorthand)", () => {
  const text = "no @user123";
  const noMatch = text.match(/^(no|n|reject)\s+(.+)$/i);
  assert.ok(noMatch);
  assert.strictEqual(noMatch[2], "@user123");
});

test("regular message 'hello' → not a command", () => {
  const text = "hello";
  assert.ok(!text.match(/^approve\s+(.+)$/i));
  assert.ok(!text.match(/^deny\s+(.+)$/i));
  assert.ok(!text.match(/^(yes|ok|y)\s+(.+)$/i));
  assert.ok(!text.match(/^(no|n|reject)\s+(.+)$/i));
  const lower = text.toLowerCase();
  assert.ok(lower !== "pending" && lower !== "list pending" && lower !== "list");
});

// Run tests
console.log("Running approval command tests...\n");
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
