/**
 * Official Statistics Sampling & Weighting System - Diagnostics
 *
 * One shared vocabulary for everything the engines need to tell the user. Every
 * methodological decision the application makes on the user's behalf — a correction
 * refused, a stratum collapsed, a class too thin to adjust — surfaces through here.
 *
 * Two properties matter and neither is cosmetic:
 *
 *   Errors do not expire. A finding that invalidates an estimate must stay on screen
 *   until it is dismissed deliberately. The previous single-slot toast auto-cleared
 *   after 4.5 seconds and was overwritten by the next message, so a calibration run
 *   emitting three warnings showed one of them, briefly.
 *
 *   Everything is retained. The accumulated log is what the Survey Methodology Report
 *   (T17) is rendered from: an estimate is only defensible if the decisions behind it
 *   can be listed, and decisions that scrolled past cannot be listed.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'success';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** Stable machine-readable identifier, e.g. FPC_NOT_CONSTANT_WITHIN_STRATUM. */
  code: string;
  message: string;
}

/** A diagnostic once recorded, with the provenance the methodology log needs. */
export interface LoggedDiagnostic extends Diagnostic {
  id: number;
  /** ISO 8601, UTC. */
  at: string;
  /** Which stage raised it, e.g. "Sampling", "Weighting", "Variance". */
  source: string;
}

/** True when a set of diagnostics contains something that invalidates the result. */
export function hasBlockingError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some(d => d.severity === 'error');
}

/** Order for display: worst first, so what matters is never below the fold. */
const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  success: 3,
};

export function bySeverity(a: Diagnostic, b: Diagnostic): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}

/**
 * Collapse repeats of the same code, keeping the first message and counting the rest.
 * The bootstrap re-calibrates once per replicate, so an unbounded channel would emit
 * the same warning a hundred times over.
 */
export function dedupeByCode(diagnostics: Diagnostic[]): Array<Diagnostic & { count: number }> {
  const byCode = new Map<string, Diagnostic & { count: number }>();
  diagnostics.forEach(d => {
    const existing = byCode.get(d.code);
    if (existing) {
      existing.count++;
    } else {
      byCode.set(d.code, { ...d, count: 1 });
    }
  });
  return Array.from(byCode.values()).sort(bySeverity);
}
