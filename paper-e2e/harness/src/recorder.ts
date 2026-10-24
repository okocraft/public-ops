export type Status = "PASS" | "FAIL" | "UNVERIFIED";

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  /** What was actually observed (received packets, log lines, positions). Never empty. */
  readonly evidence: string;
  /** Test viewpoint / operation IDs from TESTING.md covered by this check, e.g. `OP-001`. */
  readonly covers: readonly string[];
  /** What the check did, for the report's Executed column. */
  readonly executed?: string;
  /** What the check expected, for the report's Expected column. */
  readonly expected?: string;
}

/** Optional report columns for a check. */
export interface CheckDetail {
  readonly executed?: string;
  readonly expected?: string;
}

/**
 * Collects check results. A check without evidence is rejected, and a check that could not be
 * run must be recorded as UNVERIFIED instead of PASS.
 */
export class Recorder {
  readonly #results: CheckResult[] = [];

  get results(): readonly CheckResult[] {
    return this.#results;
  }

  check(
    id: string,
    title: string,
    ok: boolean,
    evidence: string,
    covers: readonly string[] = [],
    detail: CheckDetail = {},
  ): boolean {
    return this.#add(id, title, ok ? "PASS" : "FAIL", evidence, covers, detail);
  }

  unverified(
    id: string,
    title: string,
    reason: string,
    covers: readonly string[] = [],
    detail: CheckDetail = {},
  ): void {
    this.#add(id, title, "UNVERIFIED", reason, covers, detail);
  }

  /** Adds results produced by another recorder (for example from a parallel worker). */
  append(results: readonly CheckResult[]): void {
    this.#results.push(...results);
  }

  summary(): Record<Status, number> {
    const counts: Record<Status, number> = { PASS: 0, FAIL: 0, UNVERIFIED: 0 };
    for (const result of this.#results) {
      counts[result.status]++;
    }
    return counts;
  }

  toMarkdown(): string {
    const lines = [
      "| ID | Result | Check | Executed | Expected | Evidence |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const r of this.#results) {
      const cells = [r.id, r.status, r.title, r.executed ?? "-", r.expected ?? "-", r.evidence];
      lines.push(`| ${cells.map(escapeCell).join(" | ")} |`);
    }
    const s = this.summary();
    lines.push("", `PASS ${s.PASS} / FAIL ${s.FAIL} / UNVERIFIED ${s.UNVERIFIED}`);
    return lines.join("\n");
  }

  #add(
    id: string,
    title: string,
    status: Status,
    evidence: string,
    covers: readonly string[],
    detail: CheckDetail,
  ): boolean {
    if (evidence.trim() === "") {
      throw new Error(`Check ${id} has no evidence. Record what was observed.`);
    }
    this.#results.push({ id, title, status, evidence, covers, ...detail });
    return status === "PASS";
  }
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}
