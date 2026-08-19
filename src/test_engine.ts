/**
 * Official Statistics Computational Engine - Automated Test Suite
 * Validates math precision, sample draw boundaries, weight raking, and variance estimation.
 */

import { calcCochran, calcSlovin, calcComplexSurvey, allocateStrata } from './utils/samplesize';
import { drawSRS, drawStratified } from './utils/sampling';
import { adjustWeightingClass, rakeWeights } from './utils/weighting';
import { estimateTaylor, generateBootstrapWeights } from './utils/variance';
import { createRng } from './utils/random';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log("==========================================");
console.log("STARTING STATISTICAL ENGINE INTEGRATION TESTS");
console.log("==========================================");

// ==========================================
// 1. TEST: Sample Size Calculations & Rounding
// ==========================================
console.log("\n[1/4] Testing Sample Size & Stratum Allocation...");

// Cochran with FPC
const nCochranInfinite = calcCochran(null, 0.5, 0.05, 1.96); // expected 385
const nCochranFinite = calcCochran(1000, 0.5, 0.05, 1.96); // should be smaller due to FPC
console.log(`- Cochran infinite: ${nCochranInfinite} (expected 385)`);
console.log(`- Cochran finite (N=1000): ${nCochranFinite} (expected 278)`);
assert(nCochranInfinite === 385, "Cochran infinite size must be 385");
assert(nCochranFinite === 278, "Cochran finite size with N=1000 must be 278");

// Slovin's Formula
const nSlovin = calcSlovin(10000, 0.05); // expected 385
console.log(`- Slovin (N=10000, e=0.05): ${nSlovin} (expected 385)`);
assert(nSlovin === 385, "Slovin size must be 385");

// Complex Survey Adjustment
const nComplex = calcComplexSurvey(100, 1.5, 0.80); // expected 188
console.log(`- Complex Survey (n0=100, deff=1.5, rr=0.8): ${nComplex} (expected 188)`);
assert(nComplex === 188, "Complex survey size must be 188");

// Stratum Allocation with Perfect Largest Remainder (Hare-Niemeyer) Rounding
const strataSizes = { North: 12500, South: 7500, East: 3000, West: 2000 };
const totalN = 505;

// Proportional
const allocProp = allocateStrata(strataSizes, totalN, "proportional");
const sumProp = Object.values(allocProp).reduce((a, b) => a + b, 0);
console.log("- Proportional Allocation:", allocProp, `(Sum = ${sumProp})`);
assert(sumProp === totalN, `Proportional allocations sum must be exactly ${totalN}`);

// Neyman Allocation with zero-variance safeguards
const strataVariances = { North: 100, South: 0, East: 25, West: 0 }; // South and West have 0 variance
const allocNeyman = allocateStrata(strataSizes, totalN, "neyman", strataVariances);
const sumNeyman = Object.values(allocNeyman).reduce((a, b) => a + b, 0);
console.log("- Neyman Allocation (with zero variance guards):", allocNeyman, `(Sum = ${sumNeyman})`);
assert(sumNeyman === totalN, `Neyman allocations sum must be exactly ${totalN}`);
assert(allocNeyman.South >= 0 && allocNeyman.West >= 0, "Safeguard must prevent negative or invalid Neyman values");

// ==========================================
// 2. TEST: Sampling Draws & Weight Computations
// ==========================================
console.log("\n[2/4] Testing Random & Systematic Sampling Draws...");

// Generate Mock Census Frame
// Deterministic mock frame: the suite must not depend on Math.random, or assertions
// about standard errors and design effects become flaky.
const frameRng = createRng("MOCK-FRAME-V1");
const mockFrame = Array.from({ length: 1000 }, (_, i) => ({
  ID: `ID-${i}`,
  stratum: i < 600 ? "Urban" : "Rural",
  size_val: 10 + (i % 5), // for PPS
  value: 50 + frameRng.nextFloat() * 100
}));

// Simple Random Sampling without replacement (SRSwor)
const resWor = drawSRS(mockFrame, 150, "srswor", "TEST-SEED-WOR");
console.log(`- SRSwor draws: ${resWor.sample.length} elements (expected 150)`);
assert(resWor.sample.length === 150, "SRSwor draw size error");
assert(Math.abs(resWor.weights[0] - (1000 / 150)) < 1e-9, "SRSwor design weight error");

// Simple Random Sampling with replacement (SRSwr) - checking duplicates and duplicate weights
const resWr = drawSRS(mockFrame, 200, "srswr", "TEST-SEED-WR");
console.log(`- SRSwr draws: ${resWr.sample.length} elements (expected 200)`);
assert(resWr.sample.length === 200, "SRSwr draw size error");
// Hansen-Hurwitz: the per-draw design weight is N/n, and the weights must reproduce N.
assert(Math.abs(resWr.weights[0] - (1000 / 200)) < 1e-9, "SRSwr design weight must be N/n");
const wrSum = resWr.weights.reduce((a, b) => a + b, 0);
console.log(`  * SRSwr weight sum: ${wrSum.toFixed(2)} (expected 1000.00 = N)`);
assert(Math.abs(wrSum - 1000) < 1e-7, "SRSwr weights must sum to the population size N");
// The estimator must be unbiased for a total even with duplicates present.
const wrTotal = resWr.sample.reduce((s, r) => s + r.weight * 1, 0);
assert(Math.abs(wrTotal - 1000) < 1e-7, "SRSwr must estimate a unit total as N");
// Regression guard: the previous pi-based weighting overstated N by ~10% here.
const supersededWeight = 1 / (1 - Math.pow(1 - 1 / 1000, 200));
assert(Math.abs(supersededWeight * 200 - 1000) > 50, "sanity: the superseded weighting really did overshoot N");

// Systematic Sampling - checking fractional step index guard
const resSys = drawSRS(mockFrame, 137, "systematic", "TEST-SEED-SYS");
console.log(`- Systematic draws: ${resSys.sample.length} elements (expected 137)`);
assert(resSys.sample.length === 137, "Systematic draw size error");

// Stratified Sampling Draw
const stratSizesDraw = { Urban: 60, Rural: 40 };
const resStrat = drawStratified(mockFrame, "stratum", stratSizesDraw, "srswor", "TEST-SEED-STRAT");
console.log(`- Stratified draws: ${resStrat.sample.length} elements (expected 100)`);
assert(resStrat.sample.length === 100, "Stratified draw size error");
const urbanCount = resStrat.sample.filter(r => r.stratum === "Urban").length;
const ruralCount = resStrat.sample.filter(r => r.stratum === "Rural").length;
assert(urbanCount === 60, "Stratified Urban size must be 60");
assert(ruralCount === 40, "Stratified Rural size must be 40");

// --- REPRODUCIBILITY (T7): the whole point of seeding ---
// Same seed + same frame + same design => byte-identical sample.
const repA = drawSRS(mockFrame, 150, "srswor", "AUDIT-2026-08");
const repB = drawSRS(mockFrame, 150, "srswor", "AUDIT-2026-08");
const repC = drawSRS(mockFrame, 150, "srswor", "AUDIT-2026-09");
assert(JSON.stringify(repA.indices) === JSON.stringify(repB.indices),
  "Identical seeds must reproduce the identical sample");
assert(JSON.stringify(repA.indices) !== JSON.stringify(repC.indices),
  "Different seeds must produce different samples");
console.log(`- Reproducibility: seed "AUDIT-2026-08" regenerated the same ${repA.indices.length} units`);

// Stratified draws must be invariant to the ORDER strata are supplied in, because
// substreams are keyed by stratum label rather than by position.
const stratA = drawStratified(mockFrame, "stratum", { Urban: 60, Rural: 40 }, "srswor", "ORDER-TEST");
const stratB = drawStratified(mockFrame, "stratum", { Rural: 40, Urban: 60 }, "srswor", "ORDER-TEST");
const keyOf = (r: any[]) => r.map(x => x.ID).sort().join(",");
assert(keyOf(stratA.sample) === keyOf(stratB.sample),
  "Stratified draw must not depend on the order strata are listed in");
console.log("- Stratum ordering: reversing the strata map produced an identical sample");

// Bootstrap replicate weights must be reproducible too.
const bootA = generateBootstrapWeights(resStrat.sample, 20, "weight", "stratum", undefined, "BOOT-REPRO");
const bootB = generateBootstrapWeights(resStrat.sample, 20, "weight", "stratum", undefined, "BOOT-REPRO");
assert(JSON.stringify(bootA.replicateWeights) === JSON.stringify(bootB.replicateWeights),
  "Identical seeds must reproduce identical bootstrap replicate weights");
console.log("- Bootstrap: replicate weight matrix regenerated exactly from its seed");

// ==========================================
// 3. TEST: Weight Adjustments & IPF Raking
// ==========================================
console.log("\n[3/4] Testing Non-Response & Raking Calibration...");

// Mock Survey Response Sample
const surveySample = resWor.sample.map((row, idx) => ({
  ...row,
  weight: row.weight || 1.0,
  respondent: idx % 10 !== 0 ? 1 : 0, // 10% non-response rate
  weight_class: idx < 80 ? "Class_A" : "Class_B"
}));

// Weighting Class Non-Response Adjustment
const resNonResponse = adjustWeightingClass(surveySample, "weight_class", "respondent", "weight");
console.log(`- Non-Response adjust: ${resNonResponse.respondents.length} active respondents (from ${surveySample.length} initial)`);
assert(resNonResponse.respondents.length === surveySample.filter(r => r.respondent === 1).length, "Respondent filter error");

const classASumBefore = surveySample.filter(r => r.weight_class === "Class_A").reduce((s, r) => s + r.weight, 0);
const classASumAfter = resNonResponse.respondents.filter(r => r.weight_class === "Class_A").reduce((s, r) => s + r.adjusted_weight, 0);
console.log(`  * Class A total weight before: ${classASumBefore.toFixed(2)} | after: ${classASumAfter.toFixed(2)} (should match)`);
assert(Math.abs(classASumBefore - classASumAfter) < 1e-7, "Non-response adjustment must preserve sub-class weight sums");

// --- REGRESSION (T1): the adjustment must land in the LIVE weight column ---
// Previously `adjusted_weight` was written but never read: calibration ran off the
// untouched design weight, making the whole non-response module a no-op.
const halfResponseSample = Array.from({ length: 100 }, (_, i) => ({
  ID: `H-${i}`,
  weight: 10.0,
  cls: "OnlyClass",
  respondent: i % 2 === 0 ? 1 : 0 // exactly 50% response
}));
const halfAdj = adjustWeightingClass(halfResponseSample, "cls", "respondent", "weight");
const r0 = halfAdj.respondents[0];
console.log(`- 50% response class: weight 10.00 -> ${r0.weight.toFixed(2)} (expected 20.00)`);
assert(Math.abs(r0.weight - 20.0) < 1e-9, "NR adjustment must double weights at a 50% response rate");
assert(r0.weight === r0.adjusted_weight, "`weight` must carry the adjusted value into the calibration pipeline");
assert(Math.abs(r0.design_weight - 10.0) < 1e-9, "`design_weight` must preserve the pre-adjustment weight");
const halfSum = halfAdj.respondents.reduce((s, r) => s + r.weight, 0);
console.log(`  * Adjusted respondent total: ${halfSum.toFixed(2)} (expected 1000.00 = full eligible weight)`);
assert(Math.abs(halfSum - 1000.0) < 1e-7, "Adjusted respondent weights must reproduce the full eligible total");

// IPF Raking Calibration with Category Mismatch Safeguard
// Set up census margins
const rakingMargins = [
  {
    column: "stratum",
    targets: {
      Urban: 620, // census target
      Rural: 380,
      International: 50 // Category with ZERO sample respondents to trigger mismatch collapser
    }
  }
];

// Calibrate on `weight` -- the same column the app uses end to end, so the checks below
// verify the column that was actually calibrated.
const raked = rakeWeights(resNonResponse.respondents, rakingMargins, "weight", 50, 0.0001);
console.log(`- Raking Calibration convergence: ${raked.converged ? "CONVERGED" : "FAILED"} in ${raked.iterations} iterations`);
console.log(`  * Max discrepancy: ${(raked.maxDiscrepancy * 100).toFixed(6)}%`);
assert(raked.converged, "Raking calibration must converge successfully");
assert(raked.maxDiscrepancy < 0.001, "Raking discrepancy must be within tolerance");

// Verify that the population target was successfully aligned and did not crash on the "International" category
const urbanSumRaked = raked.sample.filter(r => r.stratum === "Urban").reduce((s, r) => s + r.weight, 0);
const ruralSumRaked = raked.sample.filter(r => r.stratum === "Rural").reduce((s, r) => s + r.weight, 0);
// "International" has no respondents, so its 50 units are redistributed across the
// active categories: scale = 1050/1000 = 1.05, giving Urban 651 and Rural 399.
const scale = 1050 / 1000;
const urbanTarget = 620 * scale;
const ruralTarget = 380 * scale;
console.log(`  * Raked Urban: ${urbanSumRaked.toFixed(2)} (target ${urbanTarget.toFixed(2)})`);
console.log(`  * Raked Rural: ${ruralSumRaked.toFixed(2)} (target ${ruralTarget.toFixed(2)})`);
assert(Math.abs(urbanSumRaked - urbanTarget) < 0.5, "Raked Urban total must hit the redistributed census target");
assert(Math.abs(ruralSumRaked - ruralTarget) < 0.5, "Raked Rural total must hit the redistributed census target");
assert(Math.abs((urbanSumRaked + ruralSumRaked) - 1050) < 0.5, "Calibrated weights must reproduce the full population total");
assert(raked.warnings.some(w => w.code === "TARGET_CATEGORY_COLLAPSED"), "Collapsing a zero-respondent target category must raise a warning");

// ==========================================
// 4. TEST: Variance & Design Effect Estimation
// ==========================================
console.log("\n[4/4] Testing Taylor Linearization & Bootstrap Replicates...");

// Taylor Series Linearization
const taylorEst = estimateTaylor(raked.sample, "value", "weight", "stratum");
console.log("- Taylor Series Estimation results:");
console.log(`  * Sample Mean: ${taylorEst.estimate.toFixed(4)}`);
console.log(`  * Standard Error (SE): ${taylorEst.se.toFixed(4)}`);
console.log(`  * Kish Design Effect (Deff): ${taylorEst.deff.toFixed(4)}`);
console.log(`  * CV%: ${(taylorEst.cv * 100).toFixed(4)}%`);
assert(taylorEst.estimate > 0, "Mean estimate must be positive");
assert(taylorEst.se > 0, "Standard error must be greater than zero");
// NOTE: deff >= 1 is NOT a valid invariant. Stratifying on a variable correlated with
// the outcome is meant to push the design effect below 1 -- that is the gain from
// stratification. Only assert that it is a usable finite number.
assert(Number.isFinite(taylorEst.deff) && taylorEst.deff > 0, "Design effect must be finite and positive");

// --- FINITE POPULATION CORRECTION (T8) ---
// Every draw now emits an `fpc` column holding the sampling fraction.
const fpcWor = drawSRS(mockFrame, 200, "srswor", "FPC-WOR");
assert(Math.abs(fpcWor.sample[0].fpc - 200 / 1000) < 1e-9, "SRSWOR must emit fpc = n/N");
const fpcWr = drawSRS(mockFrame, 200, "srswr", "FPC-WR");
assert(fpcWr.sample[0].fpc === 0,
  "SRSWR must emit fpc = 0: with-replacement designs take no finite population correction");
// Disproportionate allocation on purpose: Urban f_h = 60/600 = 0.10 but
// Rural f_h = 100/400 = 0.25. Equal fractions would not exercise the guard below.
const fpcStrat = drawStratified(mockFrame, "stratum", { Urban: 60, Rural: 100 }, "srswor", "FPC-STRAT");
const urbanRow = fpcStrat.sample.find(r => r.stratum === "Urban");
const ruralRow = fpcStrat.sample.find(r => r.stratum === "Rural");
assert(Math.abs(urbanRow.fpc - 60 / 600) < 1e-9, "Stratified must emit per-stratum f_h = n_h/N_h (Urban)");
assert(Math.abs(ruralRow.fpc - 100 / 400) < 1e-9, "Stratified must emit per-stratum f_h = n_h/N_h (Rural)");
assert(Math.abs(urbanRow.fpc - ruralRow.fpc) > 1e-6, "test setup: the two stratum fractions must differ");
console.log(`- FPC emitted: SRSWOR f=${fpcWor.sample[0].fpc}, SRSWR f=${fpcWr.sample[0].fpc}, Urban f_h=${urbanRow.fpc.toFixed(3)}, Rural f_h=${ruralRow.fpc.toFixed(3)}`);

// The correction must actually reduce the standard error.
const noFpc = estimateTaylor(fpcStrat.sample, "value", "weight", "stratum");
const withFpc = estimateTaylor(fpcStrat.sample, "value", "weight", "stratum", undefined, "fpc");
assert(withFpc.se < noFpc.se, "Applying the FPC must reduce the standard error");
assert(withFpc.warnings.length === 0, "A well-formed stratified design must raise no FPC warnings");
console.log(`  * SE without FPC: ${noFpc.se.toFixed(4)} -> with FPC: ${withFpc.se.toFixed(4)}`);

// GUARD: analysing a stratified sample without declaring the strata puts unequal f_h
// into one group. The correction must be REFUSED, not silently averaged.
const misdeclared = estimateTaylor(fpcStrat.sample, "value", "weight", undefined, undefined, "fpc");
assert(misdeclared.warnings.some(w => w.code === "FPC_NOT_CONSTANT_WITHIN_STRATUM"),
  "Mismatched strata declaration must raise FPC_NOT_CONSTANT_WITHIN_STRATUM");
assert(misdeclared.se >= noFpc.se * 0.99,
  "When the FPC is refused the SE must stay conservative, not shrink");
console.log("  * Mismatched strata: correction correctly refused, SE stayed conservative");

// Rao-Wu Stratified Cluster Bootstrap Replicate Weight Generation
const bootWeights = generateBootstrapWeights(raked.sample, 50, "weight", "stratum", undefined, "TEST-SEED-BOOT");
console.log(`- Rao-Wu Stratified Bootstrap: Generated ${bootWeights.replicateWeights[0].length} replicate weights for all ${bootWeights.replicateWeights.length} rows`);
assert(bootWeights.replicateWeights.length === raked.sample.length, "Bootstrap weight mapping row count error");
assert(bootWeights.replicateWeights[0].length === 50, "Bootstrap replicate column size error");

console.log("\n==========================================");
console.log("ALL STATISTICAL ENGINE TESTS COMPLETED SUCCESSFULLY!");
console.log("==========================================");
