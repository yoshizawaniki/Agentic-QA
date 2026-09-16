import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createSandbox } from "./sandbox.ts";

export interface GateWorkspace {
  root: string;
  mode: "sandbox-junction" | "inplace";
  filesCopied: number;
  notes: string[];
}

/**
 * Prepare an isolated workspace for running gates and AI work.
 * Default: copy the tree (excluding node_modules/.git/secrets) and junction-link
 * node_modules back to the target so tests run without reinstalling.
 * Writes performed inside the workspace land in the sandbox copy, not the original tree.
 */
export async function prepareGateWorkspace(opts: {
  targetRoot: string;
  destRoot: string;
  excludeGlobs: readonly string[];
  mode: "junction" | "inplace";
}): Promise<GateWorkspace> {
  if (opts.mode === "inplace") {
    return {
      root: opts.targetRoot,
      mode: "inplace",
      filesCopied: -1,
      notes: ["gates ran in-place on original tree"],
    };
  }
  const sandbox = await createSandbox({
    targetRoot: opts.targetRoot,
    workspaceRoot: opts.destRoot,
    excludeGlobs: opts.excludeGlobs,
  });
  const linked = linkNodeModules(opts.targetRoot, opts.destRoot);
  return {
    root: opts.destRoot,
    mode: "sandbox-junction",
    filesCopied: sandbox.filesCopied,
    notes: [linked ? "node_modules junction-linked to target" : "node_modules not linked (missing or exists)"],
  };
}

function linkNodeModules(targetRoot: string, sandboxRoot: string): boolean {
  const src = join(targetRoot, "node_modules");
  const dst = join(sandboxRoot, "node_modules");
  if (!existsSync(src) || existsSync(dst)) return false;
  try {
    symlinkSync(src, dst, "junction");
    return true;
  } catch {
    try {
      symlinkSync(src, dst, "dir");
      return true;
    } catch {
      return false;
    }
  }
}
