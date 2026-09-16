import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config/load.ts";

function withFiles(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "aq-config-"));
  for (const [name, content] of Object.entries(files)) {
    const abs = join(dir, name);
    mkdirSync(abs.slice(0, Math.max(abs.lastIndexOf("\\"), abs.lastIndexOf("/"))), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return dir;
}

test("detect: npm test script becomes test gate", () => {
  const dir = withFiles({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" } }),
  });
  try {
    const { config, detected } = resolveConfig(dir);
    assert.equal(config.gates.test?.cmd, "npm test");
    assert.ok(detected.includes("test:npm-script"));
    assert.equal(config.target.name, "demo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config file overrides and extends detection", () => {
  const dir = withFiles({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node --test" } }),
    "qa.config.json": JSON.stringify({
      gates: { test: { cmd: "custom-test-runner", timeout_sec: 42 }, lint: { cmd: "my-lint" } },
      secrets_env: ["MY_TOKEN"],
      ai: { enabled: false },
    }),
  });
  try {
    const { config } = resolveConfig(dir);
    assert.equal(config.gates.test?.cmd, "custom-test-runner");
    assert.equal(config.gates.test?.timeout_sec, 42);
    assert.equal(config.gates.lint?.cmd, "my-lint");
    assert.deepEqual(config.secrets_env, ["MY_TOKEN"]);
    assert.equal(config.ai.enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("safety: publishing commands rejected as gates", () => {
  const dir = withFiles({
    "qa.config.json": JSON.stringify({ gates: { build: { cmd: "git push origin main" } } }),
  });
  try {
    assert.throws(() => resolveConfig(dir), /SAFETY/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invariants accept object form", () => {
  const dir = withFiles({
    "qa.config.json": JSON.stringify({
      invariants: [{ name: "no-loss", cmd: "node check.js", category: "race" }],
    }),
  });
  try {
    const { config } = resolveConfig(dir);
    assert.equal(config.invariants.length, 1);
    assert.equal(config.invariants[0].category, "race");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
