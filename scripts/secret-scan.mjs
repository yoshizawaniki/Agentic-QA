import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skipDirs = new Set([".git", "node_modules", "runs", "dist"]);
const knownDummies = [
  "sk-abcdefghijklmnop123456",
  "sk-reallookingkey123456789",
  "sk-faketestkey0000000000",
  "sk-dockerfiletestkey000000",
  "AKIAIOSFODNN7EXAMPLE",
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4",
  "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
];
const patterns = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["openai-like", /\bsk-[A-Za-z0-9_-]{16,}\b/g],
  ["anthropic", /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g],
  ["github", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ["slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["aws", /\bAKIA[0-9A-Z]{16}\b/g],
  ["google-api", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["groq", /\bgsk_[A-Za-z0-9_-]{20,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g],
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && statSync(full).size <= 2_000_000) out.push(full);
  }
  return out;
}

const hits = [];
for (const file of walk(root)) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue;
  // The scanner's own source necessarily contains credential-shaped regex text.
  if (relative(root, file).replace(/\\/g, "/") === "scripts/secret-scan.mjs") continue;
  for (const dummy of knownDummies) {
    text = text.split(dummy).join("[KNOWN-DUMMY]");
    // Source-code fixtures often contain escaped newlines rather than the
    // literal multiline value; scrub that exact representation as well.
    const escaped = JSON.stringify(dummy).slice(1, -1);
    text = text.split(escaped).join("[KNOWN-DUMMY]");
  }
  for (const [name, re] of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      hits.push(`${relative(root, file)}:${line} (${name})`);
      if (match[0].length === 0) re.lastIndex++;
    }
  }
}

if (hits.length > 0) {
  console.error(`[secret-scan] FAIL: ${hits.length} potential secret(s)`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log("[secret-scan] PASS: no credential-shaped literals found outside known test dummies");
