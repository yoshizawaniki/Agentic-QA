import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./exec.ts";

export interface SandboxResult {
  workspaceRoot: string;
  mode: "copy" | "worktree";
  filesCopied: number;
  skipped: string[];
  /** commit sha of the pristine snapshot (diffs are computed against it) */
  baselineCommitSha?: string;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`(^|[\\\\/])${escaped}($|[\\\\/])`, "i");
}

export function makeExclusionMatcher(globs: readonly string[]): (relPath: string) => boolean {
  const regexes = globs.map(globToRegExp);
  return (relPath: string) => regexes.some((re) => re.test(relPath));
}

export async function createSandbox(opts: {
  targetRoot: string;
  workspaceRoot: string;
  excludeGlobs: readonly string[];
  forbiddenPaths?: readonly string[];
  mode?: "copy" | "worktree";
  env?: Record<string, string>;
}): Promise<SandboxResult> {
  mkdirSync(opts.workspaceRoot, { recursive: true });
  if (opts.mode === "worktree") {
    const res = await runCommand({
      cmd: `git worktree add "${opts.workspaceRoot}" --detach`,
      cwd: opts.targetRoot,
      timeout_sec: 120,
    });
    if (res.exit_code !== 0)
      throw new Error(`git worktree failed: ${res.stderr_preview || res.stdout_preview}`);
    return { workspaceRoot: opts.workspaceRoot, mode: "worktree", filesCopied: -1, skipped: [] };
  }
  const isExcluded = makeExclusionMatcher([...opts.excludeGlobs]);
  let filesCopied = 0;
  copyTree(opts.targetRoot, opts.workspaceRoot, "", isExcluded, () => filesCopied++);
  const sha = await initGitSnapshot(opts.workspaceRoot);
  return { workspaceRoot: opts.workspaceRoot, mode: "copy", filesCopied, skipped: [], baselineCommitSha: sha };
}

function copyTree(
  srcRoot: string,
  dstRoot: string,
  relPrefix: string,
  isExcluded: (rel: string) => boolean,
  onFile: () => void,
): void {
  const entries = readdirSync(join(srcRoot, relPrefix), { withFileTypes: true });
  for (const entry of entries) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (isExcluded(rel)) continue;
    const srcAbs = join(srcRoot, rel);
    const dstAbs = join(dstRoot, rel);
    if (entry.isDirectory()) {
      mkdirSync(dstAbs, { recursive: true });
      copyTree(srcRoot, dstRoot, rel, isExcluded, onFile);
    } else if (entry.isFile()) {
      try {
        cpSync(srcAbs, dstAbs);
        onFile();
      } catch {
        // unreadable file: skip, record later if needed
      }
    }
  }
}

const SANDBOX_GITIGNORE = [
  "node_modules/",
  ".opencode/node_modules/",
  ".env",
  ".env.*",
  "*.log",
].join("\n");

async function initGitSnapshot(workspaceRoot: string): Promise<string> {
  // Local-only repo used for producing diffs of QA modifications.
  const env = {
    GIT_AUTHOR_NAME: "agentic-qa",
    GIT_AUTHOR_EMAIL: "qa@local",
    GIT_COMMITTER_NAME: "agentic-qa",
    GIT_COMMITTER_EMAIL: "qa@local",
  };
  const init = await runCommand({ cmd: `git init -q`, cwd: workspaceRoot, timeout_sec: 60 });
  if (init.exit_code !== 0) throw new Error(`git init failed in sandbox: ${init.stderr_preview}`);
  writeFileSync(join(workspaceRoot, ".git", "info", "exclude"), SANDBOX_GITIGNORE + "\n", "utf8");
  const add = await runCommand({ cmd: `git add -A`, cwd: workspaceRoot, env, timeout_sec: 300 });
  if (add.exit_code !== 0) throw new Error(`git add failed in sandbox: ${add.stderr_preview}`);
  const commit = await runCommand({
    cmd: `git commit -q -m "baseline snapshot by agentic-qa" --allow-empty`,
    cwd: workspaceRoot,
    env,
    timeout_sec: 300,
  });
  if (commit.exit_code !== 0) throw new Error(`git commit failed in sandbox: ${commit.stderr_preview}`);
  const shaRes = await runCommand({ cmd: `git rev-parse HEAD`, cwd: workspaceRoot, timeout_sec: 60 });
  const sha = shaRes.stdout_preview.trim();
  if (shaRes.exit_code !== 0 || !/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`baseline snapshot verification failed: ${shaRes.stderr_preview}`);
  }
  return sha;
}

export async function sandboxDiff(workspaceRoot: string, redactLine: (s: string) => string): Promise<string> {
  // stage everything (incl. new files) so the diff captures untracked work
  const add = await runCommand({ cmd: `git add -A`, cwd: workspaceRoot, timeout_sec: 120 });
  if (add.exit_code !== 0) throw new Error(`git add failed while diffing: ${add.stderr_preview}`);
  // exclude QA-harness bookkeeping (.opencode/) from exported diffs
  const res = await runCommand({
    cmd: `git --no-pager diff HEAD --unified=3 -- . ":(exclude).opencode/**"`,
    cwd: workspaceRoot,
    timeout_sec: 60,
  });
  if (res.exit_code !== 0) {
    throw new Error(`git diff failed in sandbox (is the baseline snapshot intact?): ${res.stderr_preview}`);
  }
  return redactLine(res.stdout_preview);
}

export async function listChangedFiles(workspaceRoot: string): Promise<string[]> {
  const res = await runCommand({
    cmd: `git status --porcelain -uall`,
    cwd: workspaceRoot,
    timeout_sec: 60,
  });
  if (res.exit_code !== 0) throw new Error(`git status failed in sandbox: ${res.stderr_preview}`);
  return res.stdout_preview
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^..\s+/, ""))
    .filter((p) => p.length > 0 && !p.startsWith(".opencode/"));
}
