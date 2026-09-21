import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareGateWorkspace } from "../src/core/workspace.ts";

test("strict isolation copies node_modules instead of sharing writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "aq-workspace-"));
  const target = join(root, "target");
  const sandbox = join(root, "sandbox");
  mkdirSync(join(target, "node_modules", "demo"), { recursive: true });
  writeFileSync(join(target, "app.js"), "module.exports = 1;\n", "utf8");
  writeFileSync(join(target, "node_modules", "demo", "cache.txt"), "original\n", "utf8");
  try {
    const ws = await prepareGateWorkspace({
      targetRoot: target,
      destRoot: sandbox,
      excludeGlobs: ["node_modules"],
      mode: "copy",
    });
    assert.equal(ws.mode, "sandbox-copy");
    assert.ok(existsSync(join(sandbox, "node_modules", "demo", "cache.txt")));
    writeFileSync(join(sandbox, "app.js"), "module.exports = 2;\n", "utf8");
    assert.equal(readFileSync(join(target, "app.js"), "utf8"), "module.exports = 1;\n");
    writeFileSync(join(sandbox, "node_modules", "demo", "cache.txt"), "sandbox-only\n", "utf8");
    assert.equal(readFileSync(join(target, "node_modules", "demo", "cache.txt"), "utf8"), "original\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fast isolation copies source but documents the node_modules shared-write tradeoff", async () => {
  const root = mkdtempSync(join(tmpdir(), "aq-workspace-fast-"));
  const target = join(root, "target");
  const sandbox = join(root, "sandbox");
  mkdirSync(join(target, "node_modules", "demo"), { recursive: true });
  writeFileSync(join(target, "app.js"), "module.exports = 1;\n", "utf8");
  writeFileSync(join(target, "node_modules", "demo", "cache.txt"), "original\n", "utf8");
  try {
    const ws = await prepareGateWorkspace({
      targetRoot: target,
      destRoot: sandbox,
      excludeGlobs: ["node_modules"],
      mode: "junction",
    });
    assert.equal(ws.mode, "sandbox-junction");
    writeFileSync(join(sandbox, "app.js"), "module.exports = 2;\n", "utf8");
    assert.equal(readFileSync(join(target, "app.js"), "utf8"), "module.exports = 1;\n");
    writeFileSync(join(sandbox, "node_modules", "demo", "cache.txt"), "shared-cache\n", "utf8");
    assert.equal(readFileSync(join(target, "node_modules", "demo", "cache.txt"), "utf8"), "shared-cache\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
