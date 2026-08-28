# Sampling Suite — Fix Plan

Working task list from the methodological audit (2026-08-19).
Full audit: https://claude.ai/code/artifact/8c090389-5243-4f02-9912-1bccecdc7c7c

**How to use this file:** one task at a time, top to bottom. Mark `[x]` when the
acceptance check passes. This file is the source of truth for progress — if a
session is interrupted, the next one resumes from the first unchecked box.

Status key: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 1 — Stop shipping wrong numbers  ✅ COMPLETE (2026-08-19)

Verified: `npm test` passes, `npm run typecheck` clean, `npm run build` succeeds.

- [x] **T1. Wire non-response adjustment into the pipeline** — DONE 2026-08-19
  - Files: `src/utils/weighting.ts`, `src/App.tsx`
  - Problem: `adjusted_weight` is written (weighting.ts:110/116/332) and never read.
    Calibration starts from the raw `weight`, so both NR methods are no-ops.
  - Fix: adjustment functions write the adjusted value into `weightCol` and preserve
    the pre-adjustment value as `design_weight`; keep `adjusted_weight` for audit.
  - Accept: a weighting class with 50% response doubles its respondents' weights,
    and the doubled value is what calibration receives. VERIFIED: 10.00 -> 20.00,
    adjusted respondent total reproduces the full eligible weight (1000.00).

- [x] **T2. Fix SRS-with-replacement weights** — DONE
  - Files: `src/utils/sampling.ts`, `src/test_engine.ts`
  - Problem: keeps duplicates AND applies distinct-unit inclusion weights. Sum of
    weights != N (10% high at N=1000/n=200; 58% at n=N).
  - Fix: Hansen-Hurwitz — `w = N/n` on all n draws. Update the test that asserts
    the old wrong value.
  - Accept: `sum(weights) === N` for any n.

- [x] **T3. Guard negative weights in linear (GREG) calibration** — DONE
  - Files: `src/utils/weighting.ts`
  - Problem: `w = d(1 + x'lambda)` is unbounded below; no check exists.
  - Fix: detect `min(w) <= 0`, return `converged: false` with a structured warning
    naming the count and suggesting raking / bounded calibration.
  - Accept: a frame engineered to produce negative weights is blocked, not exported.

- [x] **T4. Fix hard-coded weight column reads** — DONE
  - Files: `src/utils/weighting.ts:831`, `src/utils/variance.ts` (3 sites)
  - Problem: `calibrateLinear` writes `[weightCol]` but its audit reads `row.weight`;
    `estimateBootstrap` hard-codes `row["weight"]`. Both break in the bootstrap
    re-calibration path where the column is `_temp_rep_weight`.
  - Also: `test_engine.ts` rakes on `adjusted_weight` but verifies by summing
    `r.weight`, so it prints "Raked Urban: 555.56 (target ~651.0)" — the engine is
    correct, the test reads the wrong column and the console message misleads.
  - Accept: no bare `row.weight` / `row["weight"]` literals remain in the engines,
    and the test verifies the column it calibrated on.

- [x] **T5. Rename "Logit" to "Truncated raking"** — DONE
  - Files: `src/App.tsx`, `README.md`
  - Problem: the option routes to clipped raking, not Deville-Sarndal logit
    calibration. Real implementation is T15; until then the label must be honest.
  - Accept: no UI or doc string claims logit calibration.

- [x] **T6. Make the test suite runnable** — DONE
  - Files: `package.json`, `src/test_engine.ts`
  - Problem: 176 lines of real assertions with no runner and no `npm test`.
  - Accept: `npm test` runs and passes.

---

## Phase 2 — Make it defensible

> Groundwork already in place from Phase 1: `RakingResult.warnings: CalibrationWarning[]`
> ({severity, code, message}) now exists and is populated for TARGET_CATEGORY_COLLAPSED,
> RAKING_NOT_CONVERGED, NEGATIVE_WEIGHTS and CALIBRATION_SYSTEM_SINGULAR. `error`-severity
> results are blocked from reaching the rest of the app. T12 extends this to the other
> engines and replaces the remaining `alert()` calls.

- [x] **T7. Seeded PRNG across every draw and replicate** — DONE 2026-08-19
  - Files: new `src/utils/random.ts`, `sampling.ts`, `variance.ts`, `App.tsx`,
    new `scripts/rng-validation.ts`
  - Algorithm: xoshiro128** + triple32 seed expansion over FNV-1a-64.
    `RNG_ALGORITHM_ID = 'xoshiro128starstar/triple32/fnv1a64/v1'`.
  - Unbiased integers via OpenBSD rejection (NOT modulo, NOT `Math.floor(f*n)`).
    Floats are the canonical 53-bit form, exactly [0,1) — the systematic draw's
    bound proof depends on 1.0 being unattainable.
  - Substreams keyed by canonical LABEL (`deriveStream(seed,'stratum','URBAN')`),
    not by index, so draws are invariant to `Object.keys()` ordering. Strata,
    clusters and multistage group keys are also explicitly sorted.
  - Math.random() calls: 11 -> 0 in the engines (2 remain in `random.ts`: one in a
    comment, one as the crypto fallback in `generateSeed`, where non-reproducibility
    is correct).
  - Accept: VERIFIED. `npm test` asserts identical seed => identical sample,
    different seed => different sample, strata-order invariance, and identical
    bootstrap replicate matrices. `npm run test:rng` runs 21 statistical checks
    (chi-square uniformity, no modulo bias at n=3, full-Fisher-Yates vs Sattolo,
    SRSWOR inclusion-probability uniformity, zeroland escape) — all pass.

- [x] **T8. Emit FPC from every draw** — DONE 2026-08-19
  - Files: `src/utils/sampling.ts`, `src/utils/variance.ts`, `src/App.tsx`
  - Per design (settled against Cochran/Kish/Lohr/Sarndal + R survey + SAS):
    srswor `n/N` · systematic `n/N` · stratified `n_h/N_h` · cluster `m/M` at PSU
    level · multistage stage-1 fraction only (ultimate-cluster estimator) ·
    **srswr 0** and **PPS 0** — both take no FPC, and applying one there
    understates the variance, which is the dangerous direction.
  - Guards in `estimateTaylor`: the correction is REFUSED (not averaged) when
    `fpc` is not constant within a declared stratum, and when it falls outside
    [0,1]. Both raise a `VarianceWarning` surfaced in the UI. This is the R
    `survey` behaviour ("fpc not constant within strata").
  - NOT auto-selected. The correction is only valid when the Strata Column
    matches the design actually drawn, and the app cannot verify that. Default
    stays "None", which is conservative (SEs slightly too large).
  - Accept: VERIFIED. `npm test` asserts the emitted fractions per design, that
    applying the FPC reduces the SE (2.5569 -> 2.3834), and that a mismatched
    strata declaration refuses the correction and keeps the SE conservative.

- [x] **T9. Lonely-PSU handling as an explicit option** — DONE 2026-08-19
  - Files: `src/utils/variance.ts`, `src/App.tsx`
  - `LonelyPsuPolicy = adjust | average | certainty | remove | fail`, default
    **adjust** (conservative: it can only push the SE up). Selectable in the UI.
  - `adjust` centres the lonely PSU on the GRAND mean over all PSUs in all strata,
    and drops the `n_h/(n_h-1)` factor — that term is 1/0 at n_h=1 and would
    return Infinity. Scale is the FPC alone, matching R's `onestrat`.
  - **Certainty gate** runs first: a take-all stratum (`fpc = 1`, or `prob = 1`
    which is the only signal under PPS) contributes zero BY DESIGN and is reported
    as `CERTAINTY_STRATUM`, not adjusted.
  - **Misconfiguration guard**: if >50% of strata are singletons the strata column
    is describing an identifier, not a design. `adjust` there would synthesise a
    plausible number numerically close to the SRS SE and hide the mistake, so it is
    refused (`STRATA_COLUMN_LOOKS_WRONG`) and the obvious zero is kept.
  - `NO_ESTIMABLE_VARIANCE` when the sample resolves to a single PSU overall.
  - Warnings name the affected strata AND their share of total weight, so the user
    can judge materiality rather than just seeing a count.
  - Accept: VERIFIED. On a frame with one atypical lonely stratum,
    remove SE=0.9014 vs adjust SE=14.7151 — a 16x understatement under the old
    silent default. Tests cover all five policies, the certainty gate, the
    misconfiguration guard, and the single-PSU case.
  - Known gap: `generateBootstrapWeights` still has its own silent `n_h <= 1`
    branch, so the two engines can disagree. Folded into T21.

- [x] **T10. Design degrees of freedom and t-based intervals** — DONE 2026-08-19
  - Files: new `src/utils/distributions.ts`, `variance.ts`, `App.tsx`
  - `df = sum_h (n_h - 1)`, accumulated during the variance pass. A singleton
    stratum supplies 0 df, so lonely PSUs cost precision twice — once in variance,
    once in degrees of freedom.
  - New `distributions.ts`: log-gamma (Lanczos), regularized incomplete beta
    (Lentz continued fraction), Student-t CDF, t quantile by bisection, and
    Acklam's normal quantile. Dependency-free.
  - **Verified against published t-tables** at df = 1, 2, 5, 10, 15, 20, 30, 60,
    120 and infinity — exact to 3 decimals at every point.
  - Both engines now report `df` and the `criticalValue` actually used; the
    bootstrap takes the design df from the Taylor pass rather than its own
    hardcoded 1.96, so the two intervals rest on the same basis.
  - `NO_DEGREES_OF_FREEDOM` when df = 0; `LOW_DEGREES_OF_FREEDOM` below 10.
  - df and t are displayed in the results panel so they can be quoted.
  - Accept: VERIFIED. df=36 gives t=2.0281 and a 3.5% wider interval than the old
    z; df=2 gives t=4.303, not 1.960, and warns.
  - Remaining from this task: logit-transformed intervals for proportions near
    0/1 (Wald is poor there). Moved to T26.

- [x] **T11. Calibration pre-flight validation** — DONE 2026-08-19
  - Files: `src/utils/weighting.ts`, `src/App.tsx`
  - New `preflightCalibration()` runs before any weight is touched, called from
    `rakeWeights`, `calibrateLinear` and `calibrateWeights`. Thresholds are tunable
    via `PreflightOptions`.
  - `MARGIN_TOTALS_INCONSISTENT` (error): margins describing different population
    totals. IPF fits one margin at a time, so no fixed point exists and the result
    depends on which margin was fitted last (Deming & Stephan 1940 require a common
    total). A specification that fails pre-flight can no longer report `converged`.
  - `SAMPLE_CATEGORY_UNMATCHED` (error): sample categories no margin controls. The
    raking loop guards updates with `if (cat in sampleWeightedSums)`, so those rows
    are never adjusted and the calibrated weights quietly stop summing to the
    population. Reported with the share of weight affected.
  - `adjustWeightingClass` now returns `warnings` too: `NR_CLASS_NO_RESPONDENTS`
    (error — that class's whole population share is dropped),
    `NR_CLASS_TOO_FEW_RESPONDENTS` and `NR_CLASS_FACTOR_TOO_LARGE` (warnings).
    These are the two failure modes Carlson & Williams (2001) name for the method.
    `adjustResponsePropensity` returns the same shape so callers can treat both
    paths identically; its diagnostics land with T20.
  - Accept: VERIFIED. Tests cover all five codes. Re-running the new assertions
    against the pre-T11 engine, 4 of 5 fail — the fifth (non-convergence on
    inconsistent margins) already happened by accident, but the old code never
    said why.
  - Lint 107 -> 110 errors, all `any[]` on the new signatures, consistent with
    every sibling. Tracked in T25.

- [x] **T12. Structured warning channel** — DONE 2026-08-19
  - New `src/utils/diagnostics.ts`: one `Diagnostic {severity, code, message}`
    vocabulary. `CalibrationWarning` and `VarianceWarning` are now aliases of it,
    so one channel carries every engine's output.
  - Severities: `error | warning | info | success`. **Errors and warnings do not
    auto-dismiss**; only info expires. The previous toast cleared after 4.5s and
    held one message, so a calibration run emitting three findings showed one of
    them, briefly.
  - `dedupeByCode` collapses repeats with a count — the bootstrap re-calibrates
    once per replicate and would otherwise emit the same finding B times.
  - Panel sorts worst-first, shows the code, and keeps an **append-only log** with
    timestamp and source. That log is what T16/T17 render the methodology report
    from; it is reachable from the panel ("Full log (n)").
  - The 28 remaining `alert()` calls are simple input prompts. `window.alert` is
    routed into the same channel rather than converting each into ceremony.
  - Accept: VERIFIED in the running app, not just by typecheck. Found and fixed a
    real bug that way: the alert severity heuristic matched a bare `error`, so the
    phrase "standard error" — ubiquitous here — stamped advisory notes as failures.
    Confirmed all three cases classify correctly after the fix.
  - Files: engines + `src/App.tsx`
  - Problem: 43 blocking `alert()` calls; engines have comments saying "a warning
    would be captured here" with no mechanism.
  - Fix: engines return `warnings[]`; UI renders them non-blocking and accumulates
    them for the eventual methodology log.

---

## Phase 3 — Project workspace

> **Target decision (2026-08-19): Electron desktop is the primary delivery target**,
> not the browser. A browser build pulling a large census frame may crash or run slow;
> the app should lean on the user's own machine capacity. Consequences below.

- [ ] **T13. Split `App.tsx` (4,061 lines, ~60 hooks) into per-module routes**
  - Also address the 1.03 MB un-split JS chunk the build warns about.
- [ ] **T14. Project store + manifest + autosave + project switcher**
  - Use the **filesystem via the Electron main process**, NOT IndexedDB: real paths,
    no quota ceiling, and projects that live where the user can back them up.
  - Needs IPC handlers in `electron/main.cjs` (which currently has none — note the
    unhandled `get-version` channel in the deferred list) and a widened preload API.
  - Browser build can fall back to IndexedDB as a demo tier.
- [ ] **T15. `.mredproj` import/export with frame SHA-256 hashing**
  - A real file on disk via native save/open dialogs. Hash on the Node side so a
    million-row frame is streamed, not materialised in renderer memory.
- [x] **T16. Methodology log behind every engine call** — DONE 2026-08-19
  - `MethodologyEvent {id, at, stage, summary, details}` in new
    `src/utils/methodology.ts`; `recordStep()` in App.tsx appends one per step.
  - Recorded today: Draw (design, n, N, seed, fingerprint, mean inclusion
    probability, sum of weights, strata column), Non-response (method, response
    indicator, class column, respondents retained), Calibration (method, margins,
    trimming bounds, advisories raised), Variance (estimate, SE, CV, CI, df, t
    multiplier, deff, strata/cluster/FPC columns, single-PSU rule).
  - Append-only and ordered: a step that was REFUSED still belongs in the record.
  - Not yet recorded: Frame load, Sample size, Allocation, Fieldwork upload.
    Straightforward to add — the recorder is in place, the handlers just need the
    call. Logged below.
- [x] **T17. Generated Survey Methodology Report** — DONE 2026-08-19
  - `buildMethodologyReport()` renders the recorded steps plus the full diagnostic
    log into a **self-contained HTML document** — no external assets, so it
    survives being emailed to a reviewer, archived beside the published figures,
    and opened years later on a machine that never ran this application.
  - Grouped by stage in lifecycle order, with a diagnostics table showing severity,
    stage, code and finding. States plainly that an estimate should not be
    published while an unresolved error stands against it, and that refused
    corrections leave the estimate conservative.
  - Reachable from the diagnostics panel: "Full log" -> "Export Methodology Report".
  - Accept: VERIFIED by generating a report from a real stratified draw and
    inspecting the rendered DOM — title, all four stage sections, three recorded
    steps and footer present; HTML-escaping clean.

---

## Phase 4 — Close the methodology gaps

- [x] **T18. Domain (subpopulation) estimation** — DONE 2026-08-19
  - `estimateTaylor` takes an optional `domain: { column, value }`. The WHOLE
    sample is still passed in; the linearised variable is zeroed outside the
    domain rather than the rows being filtered out.
  - Why it matters: the number of domain members landing in each PSU is itself a
    random outcome of the design. Filtering first conditions on it, treating a
    random quantity as fixed. It is the most common error in applied survey
    analysis and it is silent — the point estimate is identical.
  - `DOMAIN_EMPTY` (error) and `DOMAIN_SMALL` (warning, below 30 units).
  - Deff now uses the domain sample size as its SRS reference, not the full n.
  - Accept: VERIFIED. On a frame with 5 strata and a coprime 1-in-3 domain, the
    two approaches agree on the mean (39.500) but differ on SE (2.0295 vs 2.1149)
    and sharply on degrees of freedom: **115 for the design vs 35 filtered**.
  - Note: a domain that happens to be a union of whole strata IS equivalent under
    filtering; the first test frame was accidentally of that form and correctly
    showed no difference.
  - Not yet wired into the UI — the engine takes it, the variance tab does not
    expose it. Follow-up logged below.
- [ ] **T19. Real Deville-Sarndal logit calibration + trim-then-rerake outer loop**
- [x] **T20. IRLS for the propensity model** — DONE 2026-08-19
  - Replaced gradient descent (lr 0.05 decaying as 0.05/(1+0.01*iter) over averaged
    gradients, 500 iterations) with Iteratively Reweighted Least Squares, i.e.
    Newton-Raphson on the log-likelihood. Converges quadratically in 5-8 steps and
    reuses the existing `solveLinearSystem`.
  - The old solver barely moved the coefficients off zero, so every unit was fitted
    at roughly the overall response rate and the adjustment adjusted nothing — the
    same silent-no-op shape as T1. VERIFIED: on data where the young group responds
    at 0.9 and the old at 0.3, IRLS recovers **0.900 and 0.300**; the unconverged
    solver returns 0.600 for both. Adjustment factors 1.11 vs 3.33 (ratio 3.00).
  - Diagnostics through the T12 channel: `PROPENSITY_SEPARATION` (a covariate
    predicts response perfectly, so no MLE exists), `PROPENSITY_NOT_CONVERGED`,
    `PROPENSITY_EXTREME` (a fitted p below 0.05 implies a 20x+ factor before
    trimming — Little 1986 on inverse-propensity controlling bias but not variance),
    and `PROPENSITY_FIT` reporting iterations, propensity range and deviance.
  - Ridge on X'WX, and mu clamped away from the boundary: separation is routine in
    response models and would otherwise make the normal equations singular.
  - Remaining: **propensity-quintile adjustment cells** as the variance-controlling
    alternative to direct 1/p weighting. Split out as T27.

- [ ] **T27. Propensity-quintile adjustment cells**
  - Group fitted propensities into quintiles and apply a weighting-class adjustment
    within each, instead of inverting the propensity per unit. Little (1986) and
    Valliant/Dever/Kreuter treat this as the default because direct 1/p weighting
    controls bias but not variance. Reuses the `adjustWeightingClass` machinery.
- [ ] **T21. Jackknife and BRR-Fay replicate weights**
  - Also: make `generateBootstrapWeights` honour the same LonelyPsuPolicy as the
    Taylor engine; today it silently gives a singleton stratum zero bootstrap
    variance and `estimateBootstrap` hardcodes `warnings: []`.
- [ ] **T22. Design-based quantiles (Woodruff) and ratio estimation**
- [ ] **T23. Move the bootstrap off the main thread with typed-array replicate storage**
  - Given the Electron-first decision, prefer Node `worker_threads` or an Electron
    utility process over a Web Worker — more headroom, and it can stream from disk.
- [ ] **T26. Logit / Korn-Graubard intervals for proportions**
  - Wald intervals misbehave for proportions near 0 or 1 (they can exit [0,1] and
    under-cover). Split out of T10.

- [ ] **T25. Clear the lint backlog (111 problems, 107 errors)**
  - Mostly `@typescript-eslint/no-explicit-any` from the `any[]` row types used for
    arbitrary CSV columns — needs a real `SampleRow`/`FrameRow` type, which pairs
    naturally with T13's split of `App.tsx`.
  - Genuine finds worth fixing sooner: `loss` computed but never used in the
    logistic solver (`weighting.ts:200`) — it should drive the convergence check,
    see T20; `totalTargetDeviations`/`numEvaluations` dead in `rakeWeights`
    (`weighting.ts:533-534`); `vSrs` useless assignment in `variance.ts`.
  - CI runs lint as an advisory (non-blocking) job so the count stays visible.

- [ ] **T24. Stream large frame ingestion on the Node side**
  - The browser FileReader path materialises the whole file in renderer memory, which
    is exactly the crash the desktop target is meant to avoid. Also lets the `xlsx`
    prototype-pollution exposure be contained to the main process.

---

## Deferred / noted, not scheduled

- ~~Record the remaining lifecycle stages~~ — DONE 2026-08-19. Frame (CSV, Excel
  and demo paths), Fieldwork (CSV and Excel), Allocation and Sample size all
  record now. All eight stages are covered.
- **The methodology log needed a permanent entry point.** It was reachable only
  through the diagnostics panel, which appears when something goes WRONG — so a
  clean run, exactly when you want to export the report, had no way in. Found by
  running the app, not by typechecking. Now a header button showing the step
  count, always visible.

- ~~Expose domain estimation in the variance tab~~ — DONE 2026-08-19. Column +
  value dropdowns in the variance panel, with copy explaining why filtering the
  data instead gives the same mean and the wrong standard error. The chosen
  domain is recorded on the Variance methodology step.

- Cochran FPC inconsistency: `samplesize.ts:22` uses `n0/(1+(n0-1)/N)`,
  `App.tsx:410/450/463` uses `n0/(1+n0/N)`. Pick Cochran's. (Low impact.)
- Licence dialog claims "validated via HTTPS handshake" / "Stripe/Keygen server"
  in an app sold as air-gapped. Copy fix, `App.tsx:3984-3994`.
- Electron `get-version` IPC has no `ipcMain.handle`; add `setWindowOpenHandler`.
- Bootstrap re-does calibration per replicate but not the non-response adjustment;
  strictly both should be re-done to capture NR variance.
- ~~`test_engine.ts` is non-deterministic~~ — fixed in T7; the mock frame is now
  built from a seeded stream (`MOCK-FRAME-V1`) and the demo frame from
  `MRED-DEMO-FRAME-V1`.
- T7 deferred extras, worth picking up with the workspace tasks: `StreamRegistry`
  substream-collision detection, `RngAudit` block for the methodology report,
  `getState`/`rngFromState` for moving a stream into a Web Worker (T23), and
  exported known-answer vectors so a third party can verify an R/Python port.
- Build emits a 1.03 MB JS chunk with no code splitting — fold into T13.
- ~~README calls the bootstrap "McCarthy-Snowden"~~ — corrected in T5 to
  "Rao-Wu rescaled stratified cluster bootstrap".
- ~~`.gitignore` stale + build artefacts tracked~~ — RESOLVED 2026-08-19.
  Real .gitignore added; `node_modules/` (19,142 files), `dist/`,
  `dist-electron/`, `dist-electron-v3/` and `dist-electron-built/` untracked, then
  stripped from all history with `git-filter-repo`.
  **Pack size 748.31 MiB -> 621.42 KiB (1,233x smaller); 19,179 objects -> 131.**
  All 18 commits and all source preserved; tests and build verified after the
  rewrite. The largest single culprit was a `dist-electron/` directory from
  2026-05-24 (419 MB packed) that had long since left the working tree.
  Backup bundle: `C:/Users/manue/Documents/_sampling-repo-backup-20260819/full-history.bundle`
  (verified complete — delete once the force-push is confirmed good).
  All commit SHAs changed; re-clone rather than pull any other copy.
- 20 npm audit findings. The one that matters for the threat model is HIGH
  `xlsx` prototype pollution — it parses user-supplied census/survey files.
  npm's `xlsx@0.18.5` is the stale registry build; SheetJS now ships from
  cdn.sheetjs.com. Schedule a dedicated task. The rest are build-time
  (electron-builder, vite, postcss, babel).
