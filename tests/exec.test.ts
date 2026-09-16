import { test } from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../src/core/exec.ts";

test("exec: captures exit code and output", async () => {
  const res = await runCommand({
    cmd: process.platform === "win32" ? "echo hello-from-aq" : "echo hello-from-aq",
    cwd: process.cwd(),
    timeout_sec: 30,
  });
  assert.equal(res.exit_code, 0);
  assert.ok(res.stdout_preview.includes("hello-from-aq"));
});

test("exec: nonzero exit captured without throwing", async () => {
  const res = await runCommand({
    cmd: process.platform === "win32" ? "cmd /c exit 3" : "false",
    cwd: process.cwd(),
    timeout_sec: 30,
  });
  assert.equal(res.exit_code, 3);
});

test("exec: timeout kills the process tree", async () => {
  const started = Date.now();
  const res = await runCommand({
    cmd: process.platform === "win32"
      ? "ping -n 60 127.0.0.1" // blocks without external deps
      : "sleep 60",
    cwd: process.cwd(),
    timeout_sec: 2,
  });
  const elapsed = Date.now() - started;
  assert.equal(res.timed_out, true);
  assert.ok(elapsed < 20000, `timeout took ${elapsed}ms`);
});
