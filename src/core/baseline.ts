import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export interface BaselineInfo {
  recorded_at: string;
  target_root: string;
  git_head?: string;
  files: Record<string, string>;
  file_count: number;
}

function hashFile(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

export function recordBaseline(
  targetRoot: string,
  excludeGlobs: readonly string[],
  isExcludedFn: (rel: string) => boolean,
): BaselineInfo {
  const files: Record<string, string> = {};
  walk(targetRoot, "", isExcludedFn, files);
  return {
    recorded_at: new Date().toISOString(),
    target_root: targetRoot,
    git_head: tryGitHead(targetRoot),
    files,
    file_count: Object.keys(files).length,
  };
}

function tryGitHead(root: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function walk(root: string, relPrefix: string, isExcluded: (rel: string) => boolean, out: Record<string, string>): void {
  const absDir = join(root, relPrefix);
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) {
      walk(root, rel, isExcluded, out);
    } else if (entry.isFile()) {
      try {
        const st = statSync(join(root, rel));
        if (st.size > MAX_FILE_BYTES) {
          out[rel] = `size:${st.size}`;
          continue;
        }
        out[rel] = hashFile(join(root, rel));
      } catch {
        // unreadable
      }
    }
  }
}
