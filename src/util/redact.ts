const KEY_VALUE_SECRET =
  /\b(api[_-]?key|apikey|secret[_-]?(?:key|token)?|access[_-]?token|auth[_-]?token|token|password|passwd|pwd|authorization|bearer|client[_-]?secret|private[_-]?key)\b\s*([:=])\s*("[^"\n]{6,}"|'[^'\n]{6,}'|[^\s"',;)]{8,})/gi;

const TYPED_SECRETS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED-PRIVATE-KEY]"],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED-sk]"],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED-sk-ant]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED-github]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED-slack]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED-aws]"],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED-google-api-key]"],
  [/\bgsk_[A-Za-z0-9_-]{20,}\b/g, "[REDACTED-groq]"],
  [/\br8_[A-Za-z0-9_-]{20,}\b/g, "[REDACTED-replicate]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED-JWT]"],
  [/\byoutube-v3-[A-Za-z0-9_-]{16,}\b/gi, "[REDACTED-yt]"],
];

export interface Redactor {
  redact(text: string): string;
}

export function createRedactor(secretEnvNames: readonly string[] = []): Redactor {
  const literals = new Set<string>();
  for (const name of secretEnvNames) {
    const value = process.env[name];
    if (value && value.length >= 4) {
      literals.add(value);
      try {
        const decoded = Buffer.from(value, "base64").toString("utf8");
        if (/^[\x20-\x7E]+$/.test(decoded) && decoded.length >= 8) literals.add(decoded);
      } catch {
        // not base64; ignore
      }
    }
  }
  return {
    redact(text: string): string {
      let out = text;
      for (const literal of literals) {
        out = out.split(literal).join("[REDACTED]");
      }
      for (const [re, label] of TYPED_SECRETS) {
        out = out.replace(re, label);
      }
      out = out.replace(KEY_VALUE_SECRET, (_m, key: string, sep: string) => `${key}${sep} [REDACTED]`);
      return out;
    },
  };
}
