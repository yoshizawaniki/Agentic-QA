import { randomBytes } from "node:crypto";

export function runId(now = new Date()): string {
  const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${ts}-${randomBytes(3).toString("hex")}`;
}

export function shortHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  const combined = ((h1 >>> 0) ^ (h2 >>> 0)) >>> 0;
  return combined.toString(16).padStart(8, "0");
}
