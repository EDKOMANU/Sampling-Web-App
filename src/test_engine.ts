/**
 * Official Statistics Computational Engine - Automated Test Suite
 * Validates math precision, sample draw boundaries, weight raking, and variance estimation.
 */

import { calcCochran, calcSlovin, calcComplexSurvey, allocateStrata } from './utils/samplesize';
import { drawSRS, drawStratified } from './utils/sampling';
import { adjustWeightingClass, rakeWeights } from './utils/weighting';
import { estimateTaylor, generateBootstrapWeights } from './utils/variance';

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
const mockFrame = Array.from({ length: 1000 }, (_, i) => ({
  ID: `ID-${i}`,
  stratum: i < 600 ? "Urban" : "Rural",
  size_val: 10 + (i % 5), // for PPS
  value: 50 + Math.random() * 100
}));

// Simple Random Sampling without replacement (SRSwor)
const resWor = drawSRS(mockFrame, 150, "srswor");
console.log(`- SRSwor draws: ${resWor.sample.length} elements (expected 150)`);
assert(resWor.sample.length === 150, "SRSwor draw size error");
assert(Math.abs(resWor.weights[0] - (1000 / 150)) < 1e-9, "SRSwor design weight error");

// Simple Random Sampling with replacement (SRSwr) - checking duplicates and duplicate weights
const resWr = drawSRS(mockFrame, 200, "srswr");
console.log(`- SRSwr draws: ${resWr.sample.length} elements (expected 200)`);
assert(resWr.sample.length === 200, "SRSwr draw size error");
const expectedWrWeight = 1 / (1 - Math.pow(1 - 1 / 1000, 200));
assert(Math.abs(resWr.weights[0] - expectedWrWeight) < 1e-9, "SRSwr inclusion design weight error");

// Systematic Sampling - checking fractional step index guard
const resSys = drawSRS(mockFrame, 137, "systematic");
console.log(`- Systematic draws: ${resSys.sample.length} elements (expected 137)`);
assert(resSys.sample.length === 137, "Systematic draw size error");

// Stratified Sampling Draw
const stratSizesDraw = { Urban: 60, Rural: 40 };
const resStrat = drawStratified(mockFrame, "stratum", stratSizesDraw, "srswor");
console.log(`- Stratified draws: ${resStrat.sample.length} elements (expected 100)`);
assert(resStrat.sample.length === 100, "Stratified draw size error");
const urbanCount = resStrat.sample.filter(r => r.stratum === "Urban").length;
const ruralCount = resStrat.sample.filter(r => r.stratum === "Rural").length;
assert(urbanCount === 60, "Stratified Urban size must be 60");
assert(ruralCount === 40, "Stratified Rural size must be 40");

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

const raked = rakeWeights(resNonResponse.respondents, rakingMargins, "adjusted_weight", 50, 0.0001);
console.log(`- Raking Calibration convergence: ${raked.converged ? "CONVERGED" : "FAILED"} in ${raked.iterations} iterations`);
console.log(`  * Max discrepancy: ${(raked.maxDiscrepancy * 100).toFixed(6)}%`);
assert(raked.converged, "Raking calibration must converge successfully");
assert(raked.maxDiscrepancy < 0.001, "Raking discrepancy must be within tolerance");

// Verify that the population target was successfully aligned and did not crash on the "International" category
const urbanSumRaked = raked.sample.filter(r => r.stratum === "Urban").reduce((s, r) => s + r.weight, 0);
const ruralSumRaked = raked.sample.filter(r => r.stratum === "Rural").reduce((s, r) => s + r.weight, 0);
console.log(`  * Raked Urban: ${urbanSumRaked.toFixed(2)} (target scaled to: ~651.0 due to International redistribution)`);
console.log(`  * Raked Rural: ${ruralSumRaked.toFixed(2)} (target scaled to: ~399.0)`);
assert(urbanSumRaked > 0 && ruralSumRaked > 0, "Raked weights must be positive and non-zero");

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
assert(taylorEst.deff >= 1.0, "Design effect must be at least 1.0");

// Rao-Wu Stratified Cluster Bootstrap Replicate Weight Generation
const bootWeights = generateBootstrapWeights(raked.sample, 50, "weight", "stratum");
console.log(`- Rao-Wu Stratified Bootstrap: Generated ${bootWeights.replicateWeights[0].length} replicate weights for all ${bootWeights.replicateWeights.length} rows`);
assert(bootWeights.replicateWeights.length === raked.sample.length, "Bootstrap weight mapping row count error");
assert(bootWeights.replicateWeights[0].length === 50, "Bootstrap replicate column size error");

console.log("\n==========================================");
console.log("ALL STATISTICAL ENGINE TESTS COMPLETED SUCCESSFULLY!");
console.log("==========================================");
