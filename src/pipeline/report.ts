import type { RunContext } from "../core/evidence.ts";
import type { Finding, GateResult } from "../types.ts";
import { SEVERITY_ORDER } from "../types.ts";
import type { SpecContractsOutput, ArchitectureOutput } from "../ai/parse.ts";

export interface AuditReportData {
  kind: string;
  targetRoot: string;
  gates: readonly GateResult[];
  findings: readonly Finding[];
  specContracts?: SpecContractsOutput;
  architecture?: ArchitectureOutput;
  mutationSurvivedCount: number;
  mutationSkippedReason?: string;
  driftFiles: readonly string[];
  aiEnabled: boolean;
  aiAvailable: boolean;
  rounds?: number;
  extraNotes?: readonly string[];
}

function esc(s: string | undefined): string {
  return (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function generateReport(ctx: RunContext, data: AuditReportData): { mdPath: string; jsonPath: string } {
  const md = renderMarkdown(ctx, data);
  const mdPath = ctx.writeArtifact("final-report.md", md);
  const summary = {
    run_id: ctx.runId,
    kind: data.kind,
    target_root: data.targetRoot,
    generated_at: new Date().toISOString(),
    gates: data.gates.map((g) => ({ name: g.name, passed: g.passed, exit_code: g.exit_code, timed_out: g.timed_out, skipped_reason: g.skipped_reason })),
    counts_by_status: countBy(data.findings, (f) => f.final_status),
    counts_by_severity: countBy(
      data.findings.filter((f) => f.final_status !== "rejected" && f.final_status !== "duplicate"),
      (f) => f.severity,
    ),
    total_findings: data.findings.length,
    verified: data.findings.filter((f) => f.final_status === "verified").length,
    unresolved_critical_high: data.findings.filter(
      (f) =>
        (f.severity === "critical" || f.severity === "high") &&
        !["rejected", "duplicate", "verified"].includes(f.final_status),
    ).length,
    mutation_survived: data.mutationSurvivedCount,
    ai_layer: data.aiEnabled ? (data.aiAvailable ? "executed" : "unavailable") : "disabled",
  };
  const jsonPath = ctx.writeArtifact("summary.json", JSON.stringify(summary, null, 2));
  return { mdPath, jsonPath };
}

export function verdictFromSummary(summaryJson: string): "pass" | "fail" {
  try {
    const s = JSON.parse(summaryJson) as { unresolved_critical_high: number; gates: Array<{ passed: boolean }> };
    const gatesOk = s.gates.every((g) => g.passed);
    return gatesOk && s.unresolved_critical_high === 0 ? "pass" : "fail";
  } catch {
    return "fail";
  }
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

function renderMarkdown(ctx: RunContext, data: AuditReportData): string {
  const lines: string[] = [];
  lines.push(`# Agentic-QA ${data.kind} report`);
  lines.push("");
  lines.push(`- run_id: \`${ctx.runId}\``);
  lines.push(`- target: \`${ctx.redact(data.targetRoot)}\``);
  lines.push(`- generated_at: ${new Date().toISOString()}`);
  lines.push(`- AI layer: ${data.aiEnabled ? (data.aiAvailable ? "executed" : "**unavailable** (deterministic layers only)") : "disabled (--no-ai)"}`);
  if (data.rounds !== undefined) lines.push(`- campaign rounds completed: ${data.rounds}`);
  lines.push("");

  lines.push("## Deterministic gates (Layer 1)");
  lines.push("");
  lines.push("| gate | result | exit | ms | note |");
  lines.push("|---|---|---|---|---|");
  for (const g of data.gates) {
    const result = g.skipped_reason === "not_configured" ? "n/a" : g.passed ? "PASS" : "**FAIL**";
    const note = g.skipped_reason ?? (g.timed_out ? "TIMED OUT" : "");
    lines.push(`| ${g.name} | ${result} | ${g.exit_code ?? "-"} | ${g.duration_ms} | ${esc(note)} |`);
  }
  lines.push("");

  const findings = [...data.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
  lines.push("## Findings");
  lines.push("");
  if (findings.length === 0) {
    lines.push("_No findings recorded._");
    lines.push("");
  } else {
    lines.push("| id | sev | category | status | title | det.evidence |");
    lines.push("|---|---|---|---|---|---|");
    for (const f of findings) {
      lines.push(
        `| ${f.id} | ${f.severity} | ${f.category} | ${f.final_status} | ${esc(f.title)} | ${f.deterministic_evidence ? "yes" : ""} |`,
      );
    }
    lines.push("");
    lines.push("### Details");
    lines.push("");
    for (const f of findings) {
      lines.push(`#### ${f.id} — ${f.title}`);
      lines.push("");
      lines.push(`- severity: **${f.severity}** · category: ${f.category} · status: **${f.final_status}** · confidence: ${f.confidence ?? "-"}`);
      if (f.source_location?.file) {
        const loc = f.source_location;
        lines.push(`- location: \`${loc.file}${loc.line ? ":" + loc.line : ""}${loc.symbol ? " (" + loc.symbol + ")" : ""}\``);
      }
      if (f.claim) lines.push(`- claim: ${esc(f.claim)}`);
      if (f.expected) lines.push(`- expected: ${esc(f.expected)}`);
      if (f.actual) lines.push(`- actual: ${esc(f.actual)}`);
      if (f.evidence) lines.push(`- evidence: ${esc(f.evidence)}`);
      if (f.reproduction) lines.push(`- reproduction: \`${esc(f.reproduction)}\``);
      if (f.suggested_fix) lines.push(`- suggested fix: ${esc(f.suggested_fix)}`);
      if (f.verifier_status && f.verifier_status !== "not_verified")
        lines.push(`- verifier: **${f.verifier_status}**${f.verified_at ? ` at ${f.verified_at}` : ""}`);
      if (f.status_history.length > 1)
        lines.push(`- history: ${f.status_history.map((h) => h.status).join(" → ")}`);
      lines.push("");
    }
  }

  if (data.specContracts) {
    lines.push("## Extracted spec contracts");
    lines.push("");
    for (const c of data.specContracts.contracts.slice(0, 30)) {
      lines.push(`- [${c.explicit ? "explicit" : "implied"}] ${esc(c.requirement)}${c.source ? ` _(${esc(c.source)})_` : ""}`);
    }
    if (data.specContracts.contracts.length > 30)
      lines.push(`- …and ${data.specContracts.contracts.length - 30} more (see ai/spec-contracts.json)`);
    lines.push("");
  }

  if (data.architecture) {
    lines.push("## Architecture map (AI Explorer)");
    lines.push("");
    lines.push(esc(data.architecture.summary));
    lines.push("");
    if (data.architecture.dangerous_paths.length > 0) {
      lines.push("**Dangerous paths:**");
      lines.push("");
      for (const p of data.architecture.dangerous_paths.slice(0, 15)) lines.push(`- ${esc(p)}`);
      lines.push("");
    }
  }

  lines.push("## Mutation testing");
  lines.push("");
  if (data.mutationSkippedReason) lines.push(`skipped: ${data.mutationSkippedReason}`);
  else lines.push(`survived mutants (test-suite gaps): **${data.mutationSurvivedCount}**`);
  lines.push("");

  if (data.driftFiles.length > 0) {
    lines.push("## ⚠ Target tree drift during run");
    lines.push("");
    lines.push("The following files in the ORIGINAL target changed while the run executed:");
    lines.push("");
    for (const f of data.driftFiles) lines.push(`- ${f}`);
    lines.push("");
  }

  if (data.extraNotes && data.extraNotes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const n of data.extraNotes) lines.push(`- ${esc(n)}`);
    lines.push("");
  }

  lines.push("## Evidence layout");
  lines.push("");
  lines.push("```text");
  lines.push(`${ctx.runDir}`);
  lines.push("├── manifest.json          run metadata");
  lines.push("├── commands.jsonl         every executed command (redacted)");
  lines.push("├── gates.jsonl            deterministic gate results");
  lines.push("├── findings.jsonl         finding ledger");
  lines.push("├── logs/                  stdout/stderr per command");
  lines.push("├── ai/                    raw AI role outputs");
  lines.push("├── verifier/              independent verification records");
  lines.push("├── patches/               fix patches (repair runs)");
  lines.push("└── final-report.md        this file");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}
