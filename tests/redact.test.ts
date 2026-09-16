import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor } from "../src/util/redact.ts";

test("redact: masks OpenAI-style keys", () => {
  const r = createRedactor();
  const out = r.redact("using sk-abcdefghijklmnop123456 today");
  assert.ok(!out.includes("sk-abcdefghijklmnop123456"));
  assert.ok(out.includes("[REDACTED"));
});

test("redact: masks key=value pairs for secret-ish names", () => {
  const r = createRedactor();
  const out = r.redact("api_key=supersecretvalue123 and password: hunter2hunter2");
  assert.ok(!out.includes("supersecretvalue123"));
  assert.ok(!out.includes("hunter2hunter2"));
});

test("redact: masks env literal values by name", () => {
  process.env["AQ_TEST_TOKEN"] = "literal-value-xyz123";
  const r = createRedactor(["AQ_TEST_TOKEN"]);
  const out = r.redact("header contains literal-value-xyz123 inside");
  assert.ok(!out.includes("literal-value-xyz123"));
  delete process.env["AQ_TEST_TOKEN"];
});

test("redact: masks AWS/JWT/GitHub tokens", () => {
  const r = createRedactor();
  const samples = [
    "AKIAIOSFODNN7EXAMPLE",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
  ];
  for (const s of samples) {
    const out = r.redact(`prefix ${s} suffix`);
    assert.ok(!out.includes(s), `failed to redact sample`);
  }
});

test("redact: leaves normal text untouched", () => {
  const r = createRedactor();
  const src = "function clamp(v, min, max) { return v; } // token bucket rate limiter";
  assert.strictEqual(r.redact(src), src);
});
