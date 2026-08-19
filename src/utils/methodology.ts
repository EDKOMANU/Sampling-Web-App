/**
 * Official Statistics Sampling & Weighting System - Methodology Record
 *
 * A survey estimate is only defensible if the decisions behind it can be listed. This
 * module records those decisions as they are made and renders them into the document a
 * statistical office is obliged to publish alongside its figures — design, allocation,
 * response, calibration diagnostics, variance method, degrees of freedom.
 *
 * The record is append-only and ordered. It is not a summary written afterwards from
 * whatever state survived; it is what actually happened, in sequence, including the
 * steps that were refused and why.
 */

import type { LoggedDiagnostic } from './diagnostics';

export type MethodologyStage =
  | 'Frame'
  | 'Sample size'
  | 'Allocation'
  | 'Draw'
  | 'Fieldwork'
  | 'Non-response'
  | 'Calibration'
  | 'Variance';

export interface MethodologyEvent {
  id: number;
  /** ISO 8601, UTC. */
  at: string;
  stage: MethodologyStage;
  /** Short human-readable statement of what was done. */
  summary: string;
  /** Parameters that would be needed to reproduce this step. */
  details: Record<string, string | number | boolean>;
}

export interface ReportInput {
  events: MethodologyEvent[];
  diagnostics: LoggedDiagnostic[];
  generatedAt: string;
  appVersion: string;
  rngAlgorithm: string;
}

function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detailRows(details: Record<string, string | number | boolean>): string {
  const keys = Object.keys(details);
  if (keys.length === 0) return '';
  return `<dl>${keys.map(k =>
    `<dt>${esc(k)}</dt><dd>${esc(details[k])}</dd>`).join('')}</dl>`;
}

/**
 * Render the methodology report as a self-contained HTML document.
 *
 * Self-contained on purpose: it has to survive being emailed to a reviewer, archived
 * next to the published figures, and opened years later on a machine that has never
 * heard of this application.
 */
export function buildMethodologyReport(input: ReportInput): string {
  const { events, diagnostics, generatedAt, appVersion, rngAlgorithm } = input;

  const byStage = new Map<MethodologyStage, MethodologyEvent[]>();
  events.forEach(e => {
    const list = byStage.get(e.stage) || [];
    list.push(e);
    byStage.set(e.stage, list);
  });

  const stageOrder: MethodologyStage[] = [
    'Frame', 'Sample size', 'Allocation', 'Draw', 'Fieldwork',
    'Non-response', 'Calibration', 'Variance',
  ];

  const errors = diagnostics.filter(d => d.severity === 'error');
  const warns = diagnostics.filter(d => d.severity === 'warning');

  const sections = stageOrder
    .filter(st => byStage.has(st))
    .map(st => {
      const list = byStage.get(st)!;
      return `<section><h2>${esc(st)}</h2>${list.map(e => `
        <article>
          <h3>${esc(e.summary)}</h3>
          <p class="ts">${esc(e.at.replace('T', ' ').slice(0, 19))} UTC</p>
          ${detailRows(e.details)}
        </article>`).join('')}</section>`;
    }).join('');

  const diagnosticSection = diagnostics.length === 0 ? `
    <section><h2>Diagnostics</h2><p class="none">No methodological issues were raised.</p></section>`
    : `<section><h2>Diagnostics</h2>
      <p>${errors.length} finding${errors.length === 1 ? '' : 's'} that prevented a step from being
      applied, and ${warns.length} advisory note${warns.length === 1 ? '' : 's'}.
      An estimate should not be published while an unresolved error stands against it.</p>
      <table>
        <thead><tr><th>Time (UTC)</th><th>Severity</th><th>Stage</th><th>Code</th><th>Finding</th></tr></thead>
        <tbody>${diagnostics.map(d => `<tr class="${esc(d.severity)}">
          <td class="mono">${esc(d.at.replace('T', ' ').slice(0, 19))}</td>
          <td class="mono sev">${esc(d.severity)}</td>
          <td class="mono">${esc(d.source)}</td>
          <td class="mono">${esc(d.code)}</td>
          <td>${esc(d.message)}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Survey Methodology Report</title>
<style>
  :root { --ink:#14201d; --mid:#4a584f; --faint:#77877f; --rule:#d9e0dc; --accent:#0e6e63;
          --crit:#a3301c; --warn:#7e5806; --ground:#fdfdfc; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); line-height:1.6;
         font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:52rem; margin:0 auto; padding:3rem 1.5rem 5rem; }
  header { border-bottom:2px solid var(--ink); padding-bottom:1.25rem; margin-bottom:2.5rem; }
  h1 { font-size:1.9rem; margin:0 0 .4rem; letter-spacing:-.01em; }
  .sub { color:var(--mid); margin:0; font-size:.95rem; }
  .meta { margin-top:1.25rem; font-size:.78rem; color:var(--faint);
          font-family:ui-monospace,Menlo,Consolas,monospace; display:flex; flex-wrap:wrap; gap:.4rem 2rem; }
  h2 { font-size:1.05rem; text-transform:uppercase; letter-spacing:.06em; color:var(--accent);
       border-bottom:1px solid var(--rule); padding-bottom:.4rem; margin:2.5rem 0 1rem; }
  h3 { font-size:1rem; margin:1.5rem 0 .2rem; }
  .ts { font-size:.72rem; color:var(--faint); margin:0 0 .6rem;
        font-family:ui-monospace,Menlo,Consolas,monospace; }
  dl { display:grid; grid-template-columns:minmax(9rem,auto) 1fr; gap:.3rem 1.25rem;
       margin:.6rem 0 0; font-size:.88rem; }
  dt { color:var(--mid); font-family:ui-monospace,Menlo,Consolas,monospace; font-size:.78rem; }
  dd { margin:0; }
  table { border-collapse:collapse; width:100%; font-size:.82rem; margin-top:1rem; }
  th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--rule); vertical-align:top; }
  th { font-size:.7rem; text-transform:uppercase; letter-spacing:.06em; color:var(--faint); }
  .mono { font-family:ui-monospace,Menlo,Consolas,monospace; white-space:nowrap; }
  tr.error .sev { color:var(--crit); font-weight:600; }
  tr.warning .sev { color:var(--warn); font-weight:600; }
  .none { color:var(--mid); font-style:italic; }
  footer { margin-top:3rem; padding-top:1.25rem; border-top:1px solid var(--rule);
           font-size:.75rem; color:var(--faint); }
  @media print { body { background:#fff; } .wrap { padding:0; max-width:none; } }
</style></head>
<body><div class="wrap">
<header>
  <h1>Survey Methodology Report</h1>
  <p class="sub">The design decisions behind these estimates, in the order they were made.</p>
  <div class="meta">
    <span>Generated ${esc(generatedAt.replace('T', ' ').slice(0, 19))} UTC</span>
    <span>Mr_Ed Sampling Suite ${esc(appVersion)}</span>
    <span>RNG ${esc(rngAlgorithm)}</span>
  </div>
</header>
${sections || '<section><p class="none">No steps have been recorded in this session yet.</p></section>'}
${diagnosticSection}
<footer>
  Reproducibility: any draw recorded above can be regenerated exactly from its seed,
  the same population frame, and the same design parameters. Where a correction was
  refused rather than applied, the reason is recorded in the diagnostics table and the
  affected estimate is conservative — its standard error is larger than the truth, not
  smaller.
</footer>
</div></body></html>`;
}
