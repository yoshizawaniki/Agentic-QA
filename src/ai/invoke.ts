import type { AgentRunner, AiRunResult } from "./runner.ts";
import type { Schema } from "../util/schema.ts";
import { OUTPUT_CONTRACT, parseStructured } from "./parse.ts";

export interface RoleInvocation<T> {
  cwd: string;
  agent: string;
  model?: string;
  title: string;
  promptBody: string;
  schema: Schema;
  timeoutSec: number;
}

/**
 * Runs a role agent and parses its structured output.
 * Retries once with schema feedback on parse failure (context separation preserved:
 * the corrective message contains only the schema errors, not any prior reasoning).
 */
export async function runRole<T>(runner: AgentRunner, inv: RoleInvocation<T>): Promise<{
  ok: boolean;
  data?: T;
  raw?: string;
  error?: string;
  duration_ms: number;
}> {
  const prompt = `${inv.promptBody}\n${OUTPUT_CONTRACT}\nJSON SCHEMA:\n${JSON.stringify(inv.schema)}`;
  let result: AiRunResult = await runner.run({
    cwd: inv.cwd,
    agent: inv.agent,
    model: inv.model,
    title: inv.title,
    prompt,
    timeoutSec: inv.timeoutSec,
  });
  // retry only for parse failures of a real model response — never for
  // timeouts/transport errors (a second full wait doubles wall time for nothing)
  const isTimeout = /timed out/i.test(result.error ?? "");
  if (!result.ok && !isTimeout && !result.output) {
    return { ok: false, error: result.error, duration_ms: result.duration_ms };
  }
  let parsed = parseStructured<T>(result.output ?? "", inv.schema);
  if (!parsed.ok && !isTimeout && (result.ok || result.output)) {
    const retryPrompt = `${prompt}\n\nYour previous response could not be parsed. Errors: ${(
      parsed.errors ?? []
    ).join("; ")}. Respond again following the OUTPUT CONTRACT exactly.`;
    const retry = await runner.run({
      cwd: inv.cwd,
      agent: inv.agent,
      model: inv.model,
      title: inv.title + " retry",
      prompt: retryPrompt,
      timeoutSec: inv.timeoutSec,
    });
    if (retry.ok || retry.output) {
      result = retry;
      parsed = parseStructured<T>(retry.output ?? "", inv.schema);
    }
  }
  return {
    ok: parsed.ok,
    data: parsed.data,
    raw: result.output,
    error: parsed.ok ? undefined : (parsed.errors ?? [result.error ?? "unknown"]).join("; "),
    duration_ms: result.duration_ms,
  };
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}
