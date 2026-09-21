import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "agentic-qa-package-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env.npm_execpath;

function run(bin, args, opts = {}) {
  const isWindowsCmd = process.platform === "win32" && /\.cmd$/i.test(bin);
  const shell = process.env.ComSpec ?? "cmd.exe";
  const quote = (value) => '"' + String(value).replace(/"/g, '""') + '"';
  const res = isWindowsCmd
    ? spawnSync(shell, ["/d", "/s", "/c", '"' + [bin, ...args].map(quote).join(" ") + '"'], {
        cwd: opts.cwd ?? root,
        encoding: "utf8",
        env: process.env,
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
    : spawnSync(bin, args, {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    env: process.env,
      });
  if (res.error) throw res.error;
  return res;
}

function runNpm(args, opts = {}) {
  if (npmExecPath) return run(process.execPath, [npmExecPath, ...args], opts);
  return run(npm, args, opts);
}

function findFiles(rootDir, wantedName, out = []) {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const full = join(rootDir, entry.name);
    if (entry.isDirectory()) findFiles(full, wantedName, out);
    else if (entry.name === wantedName) out.push(full);
  }
  return out;
}

try {
  const pack = runNpm(["pack", "--json", "--pack-destination", temp]);
  if (pack.status !== 0) throw new Error(`npm pack failed\n${pack.stdout}\n${pack.stderr}`);
  const jsonStart = pack.stdout.indexOf("[");
  if (jsonStart < 0) throw new Error(`npm pack --json returned no JSON: ${pack.stdout}`);
  const packed = JSON.parse(pack.stdout.slice(jsonStart));
  if (!Array.isArray(packed) || packed.length !== 1) throw new Error("unexpected npm pack JSON shape");
  const info = packed[0];
  const paths = new Set((info.files ?? []).map((f) => String(f.path).replace(/\\/g, "/")));

  for (const required of [
    "dist/cli.js",
    ".opencode/agent/qa-implementer.md",
    ".opencode/agent/qa-test-designer.md",
    "fixtures/fixture-a/package.json",
    "README.md",
    "LICENSE",
  ]) {
    if (!paths.has(required)) throw new Error(`packed tarball missing ${required}`);
  }
  for (const path of paths) {
    if (/^(src|tests|runs|node_modules|scripts|\.git)(\/|$)/.test(path)) {
      throw new Error(`packed tarball contains development/local artifact: ${path}`);
    }
  }

  const tarball = resolve(temp, info.filename);
  if (!existsSync(tarball)) throw new Error(`tarball missing after npm pack: ${tarball}`);
  const installDir = join(temp, "consumer");
  mkdirSync(installDir, { recursive: true });
  const install = runNpm(["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: installDir });
  if (install.status !== 0) throw new Error(`tarball install failed\n${install.stdout}\n${install.stderr}`);

  const bin = join(installDir, "node_modules", ".bin", process.platform === "win32" ? "agentic-qa.cmd" : "agentic-qa");
  if (!existsSync(bin)) throw new Error(`installed CLI shim not found: ${bin}`);
  const help = run(bin, ["--help"], { cwd: installDir });
  if (help.status !== 0 || !/Usage:\s*\n\s*agentic-qa audit/.test(help.stdout)) {
    throw new Error(`installed CLI --help failed (exit ${help.status})\n${help.stdout}\n${help.stderr}`);
  }

  const runsDir = join(temp, "installed-runs");
  const fixture = join(root, "fixtures", "fixture-a");
  const audit = run(bin, ["audit", fixture, "--no-ai", "--runs-dir", runsDir], {
    cwd: installDir,
  });
  if (![0, 1].includes(audit.status ?? -1)) {
    throw new Error(`installed CLI audit failed as a tool error (exit ${audit.status})\n${audit.stdout}\n${audit.stderr}`);
  }
  const summaries = existsSync(runsDir) ? findFiles(runsDir, "summary.json") : [];
  if (summaries.length === 0) throw new Error("installed CLI audit produced no summary.json");
  const summary = JSON.parse(readFileSync(summaries[0], "utf8"));
  if (typeof summary !== "object" || summary === null) throw new Error("installed CLI audit summary is invalid JSON");
  const manifests = findFiles(runsDir, "manifest.json");
  if (manifests.length === 0) throw new Error("installed CLI audit produced no manifest.json");
  const manifest = JSON.parse(readFileSync(manifests[0], "utf8"));
  if (manifest.agentic_qa_version !== info.version) {
    throw new Error(
      `installed CLI reported version ${manifest.agentic_qa_version ?? "(missing)"}; expected ${info.version}`,
    );
  }
  const fvr = run(bin, ["eval-fvr", "--no-ai"], { cwd: installDir });
  if (fvr.status !== 0 || !fvr.stdout.includes('"oracle_correct": false') || !fvr.stdout.includes('"oracle_correct": true')) {
    throw new Error(
      `installed CLI eval-fvr --no-ai failed (exit ${fvr.status})\n${fvr.stdout}\n${fvr.stderr}`,
    );
  }

  console.log(
    `[package-smoke] PASS ${info.filename}; files=${paths.size}; installed CLI help=PASS; fixture audit=PASS(exit ${audit.status}); fvr-probe=PASS; version=${manifest.agentic_qa_version}`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
