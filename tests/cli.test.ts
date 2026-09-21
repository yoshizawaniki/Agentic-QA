import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, repairExitCode, auditExitCode, resolveRunsRoot, shouldRunMain } from "../src/cli.ts";

test("parseArgs: command + positional + flags with values", () => {
  const args = parseArgs(["audit", "some/target", "--no-mutation", "--model", "openrouter/x:free", "--runs-dir", "D:\\tmp\\runs"]);
  assert.equal(args.command, "audit");
  assert.deepEqual(args.positional, ["some/target"]);
  assert.equal(args.flags["no-mutation"], true);
  assert.equal(args.flags["model"], "openrouter/x:free");
  assert.equal(args.flags["runs-dir"], "D:\\tmp\\runs");
});

test("parseArgs: boolean flag at end and unknown order", () => {
  const args = parseArgs(["repair", ".", "--no-ai"]);
  assert.equal(args.command, "repair");
  assert.equal(args.flags["no-ai"], true);
});

test("parseArgs: no command yields help path", () => {
  const args = parseArgs([]);
  assert.equal(args.command, undefined);
});

test("repairExitCode: fail only when nothing verified and something not fixed", () => {
  assert.equal(repairExitCode(0, 0), 0);
  assert.equal(repairExitCode(2, 1), 0);
  assert.equal(repairExitCode(0, 3), 1);
});

test("auditExitCode and resolveRunsRoot", () => {
  assert.equal(auditExitCode("pass"), 0);
  assert.equal(resolveRunsRoot({ "runs-dir": "X:\\r" }, "C:\\w"), "X:\\r");
  const fallback = resolveRunsRoot({}, "C:\\w");
  assert.ok(fallback.includes("runs"));
});

test("packaged dist CLI is recognized as a direct invocation", () => {
  assert.equal(shouldRunMain("/tmp/node_modules/agentic-qa/dist/cli.js"), true);
  assert.equal(shouldRunMain("C:\\repo\\src\\cli.ts"), true);
  assert.equal(shouldRunMain("C:\\repo\\tests\\cli.test.ts"), false);
});
