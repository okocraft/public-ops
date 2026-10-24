export type Status = "PASS" | "FAIL" | "UNVERIFIED";

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  /** What was actually observed (received packets, log lines, positions). Never empty. */
  readonly evidence: string;
  /** Test viewpoint / operation IDs from TESTING.md covered by this check, e.g. `OP-001`. */
  readonly covers: readonly string[];
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
  ): boolean {
    return this.#add(id, title, ok ? "PASS" : "FAIL", evidence, covers);
  }

  unverified(id: string, title: string, reason: string, covers: readonly string[] = []): void {
    this.#add(id, title, "UNVERIFIED", reason, covers);
  }

  summary(): Record<Status, number> {
    const counts: Record<Status, number> = { PASS: 0, FAIL: 0, UNVERIFIED: 0 };
    for (const result of this.#results) {
      counts[result.status]++;
    }
    return counts;
  }

  toMarkdown(): string {
    const lines = ["| ID | Result | Check | Evidence |", "| --- | --- | --- | --- |"];
    for (const r of this.#results) {
      lines.push(`| ${r.id} | ${r.status} | ${escapeCell(r.title)} | ${escapeCell(r.evidence)} |`);
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
  ): boolean {
    if (evidence.trim() === "") {
      throw new Error(`Check ${id} has no evidence. Record what was observed.`);
    }
    this.#results.push({ id, title, status, evidence, covers });
    return status === "PASS";
  }
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}
