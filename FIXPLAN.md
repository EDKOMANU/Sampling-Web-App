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

- [ ] **T10. Design degrees of freedom and t-based intervals**
  - Files: `src/utils/variance.ts`, `src/App.tsx`
  - Problem: z=1.96 hard-coded in 4 places. df = (#PSUs - #strata).
  - Also: logit-transformed intervals for proportions near 0/1.

- [ ] **T11. Calibration pre-flight validation**
  - Files: `src/utils/weighting.ts`, `src/App.tsx`
  - Checks: all margin totals agree within tolerance; sample categories with no
    matching target are listed; weighting classes below a minimum respondent count
    or above a maximum adjustment factor are flagged for collapsing.

- [ ] **T12. Structured warning channel**
  - Partly built: `CalibrationWarning` (T3) and `VarianceWarning` (T8) exist and
    are surfaced. T12 unifies them and replaces the remaining `alert()` calls.
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
- [ ] **T16. Methodology log behind every engine call**
- [ ] **T17. Generated Survey Methodology Report**

---

## Phase 4 — Close the methodology gaps

- [ ] **T18. Domain (subpopulation) estimation** — biggest functional gap
- [ ] **T19. Real Deville-Sarndal logit calibration + trim-then-rerake outer loop**
- [ ] **T20. IRLS for the propensity model + propensity-quintile adjustment cells**
- [ ] **T21. Jackknife and BRR-Fay replicate weights**
  - Also: make `generateBootstrapWeights` honour the same LonelyPsuPolicy as the
    Taylor engine; today it silently gives a singleton stratum zero bootstrap
    variance and `estimateBootstrap` hardcodes `warnings: []`.
- [ ] **T22. Design-based quantiles (Woodruff) and ratio estimation**
- [ ] **T23. Move the bootstrap off the main thread with typed-array replicate storage**
  - Given the Electron-first decision, prefer Node `worker_threads` or an Electron
    utility process over a Web Worker — more headroom, and it can stream from disk.
- [ ] **T24. Stream large frame ingestion on the Node side**
  - The browser FileReader path materialises the whole file in renderer memory, which
    is exactly the crash the desktop target is meant to avoid. Also lets the `xlsx`
    prototype-pollution exposure be contained to the main process.

---

## Deferred / noted, not scheduled

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
