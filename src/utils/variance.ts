/**
 * Official Statistics Sampling & Weighting System - Variance & Standard Error Engine
 * Written in pure TypeScript with absolute mathematical precision and robust safeguards.
 * 
 * Implements:
 * 1. Stratified Taylor Series Linearization for Means and Totals.
 * 2. Rao-Wu / McCarthy-Snowden Stratified Cluster Bootstrap Resampling.
 * 3. Standard Errors, CVs, and Design Effects (Deff) calculations with R-equivalent accuracy.
 *
 * REPRODUCIBILITY: bootstrap replicate weights are generated from a seed, with one
 * substream per (replicate, stratum) keyed by the stratum label. See utils/random.ts.
 */

import type { SeedInput } from './random';
import { deriveStream } from './random';

export interface VarianceWarning {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/**
 * How to treat a stratum containing a single PSU ("lonely PSU"), where the deviation
 * from the stratum mean is identically zero and no variance is estimable from it.
 * Names match R survey's options(survey.lonely.psu=).
 *
 *  adjust    - centre the lonely PSU on the GRAND mean instead of its own stratum mean.
 *              Conservative: it can only push the standard error up. Default.
 *  average   - impute the mean contribution of the strata that did have >= 2 PSUs.
 *  certainty - contribute zero. Correct ONLY for a genuine take-all stratum.
 *  remove    - contribute zero regardless. Anticonservative; opt-in only.
 *  fail      - refuse to produce a standard error.
 */
export type LonelyPsuPolicy = 'adjust' | 'average' | 'certainty' | 'remove' | 'fail';

export interface EstimationResult {
  estimate: number;
  se: number;
  cv: number;
  ciLower: number;
  ciUpper: number;
  deff: number;
  warnings: VarianceWarning[];
}

/**
 * Perform design-based Taylor Series Linearization for a total or mean
 * @param sample The survey sample array
 * @param targetCol Column containing the variable of interest (e.g. "Income")
 * @param weightCol Column containing final survey weights
 * @param strataCol Optional column containing stratification groups
 * @param fpcCol Optional column containing finite population correction fractions (n_h / N_h)
 * @param type Estimation type: "mean" or "total"
 */
export function estimateTaylor(
  sample: any[],
  targetCol: string,
  weightCol = "weight",
  strataCol?: string,
  clusterCol?: string,
  fpcCol?: string,
  type: "mean" | "total" = "mean",
  lonelyPsuPolicy: LonelyPsuPolicy = 'adjust'
): EstimationResult {
  const warnings: VarianceWarning[] = [];
  const n = sample.length;
  if (n === 0) {
    return { estimate: 0, se: 0, cv: 0, ciLower: 0, ciUpper: 0, deff: 1.0, warnings };
  }

  // 1. Calculate point estimate
  let weightedSumY = 0;
  let sumW = 0;
  
  sample.forEach(row => {
    const y = Number(row[targetCol]) || 0;
    const w = Number(row[weightCol]) || 1.0;
    weightedSumY += w * y;
    sumW += w;
  });

  const estimate = type === "mean" ? (sumW > 0 ? weightedSumY / sumW : 0) : weightedSumY;

  // 2. Stratify, Cluster, and calculate linearized variables (z_i)
  // If strataCol is not provided, treat entire sample as a single stratum
  // If clusterCol is provided, we must aggregate z_i to the Primary Sampling Unit (PSU) level
  const strataGroups: Record<string, {
    psuMap: Record<string, { zSum: number; fpcList: number[]; probList: number[]; wSum: number }>;
  }> = {};

  sample.forEach((row, rowIndex) => {
    const s = strataCol ? String(row[strataCol]) : "single";
    const c = clusterCol ? String(row[clusterCol]) : `unit_${rowIndex}`;
    const y = Number(row[targetCol]) || 0;
    const w = Number(row[weightCol]) || 1.0;
    const fpc = fpcCol ? (Number(row[fpcCol]) || 0) : 0;

    // Linearized variable z_hij
    // For Mean: z_hij = (w_hij / sumW) * (y_hij - estimate)
    // For Total: z_hij = w_hij * y_hij
    const z = type === "mean"
      ? (sumW > 0 ? (w / sumW) * (y - estimate) : 0)
      : w * y;

    if (!strataGroups[s]) {
      strataGroups[s] = { psuMap: {} };
    }

    const grp = strataGroups[s];
    if (!grp.psuMap[c]) {
      grp.psuMap[c] = { zSum: 0, fpcList: [], probList: [], wSum: 0 };
    }
    
    // Aggregate to PSU level
    grp.psuMap[c].zSum += z;
    grp.psuMap[c].fpcList.push(fpc);
    // `prob` is the inclusion probability written by the draw engines. It is the ONLY
    // signal that identifies a design-intended certainty PSU under PPS, where `fpc` is
    // deliberately 0. Kept as-is (may be NaN when the column is absent).
    grp.psuMap[c].probList.push(Number(row['prob']));
    grp.psuMap[c].wSum += w;
  });

  // 3. Compute design-based variance
  // V = sum_h [ (1 - f_h) * (n_h / (n_h - 1)) * sum_i (z_hi - mean_z_h)^2 ]
  // where n_h is the number of PSUs in stratum h, and z_hi is the PSU sum of z.
  let totalVariance = 0;

  // --- Pre-pass: grand mean of the PSU-level linearised totals ---------------
  // Needed by the `adjust` lonely-PSU rule. It is the mean over EVERY PSU in EVERY
  // stratum (denominator = total PSU count), NOT the average of per-stratum means,
  // which would differ whenever strata hold unequal numbers of PSUs.
  //
  // Two algebraic facts worth stating, because they change what the code must do:
  //   type "mean":  z = (w/sumW)(y - estimate), so sum(z) = 0 EXACTLY. grandMeanZ is
  //                 therefore ~0 and `adjust` reduces to squaring the raw PSU z. This
  //                 is why R's implementation simply does not centre in this case.
  //   type "total": z = w*y, so sum(z) = the estimate itself and grandMeanZ =
  //                 estimate / PSU count -- a real subtraction that must be done.
  let grandZSum = 0;
  let grandPsuCount = 0;
  let grandWeight = 0;
  Object.keys(strataGroups).forEach(sk => {
    const pm = strataGroups[sk].psuMap;
    Object.keys(pm).forEach(c => {
      grandZSum += pm[c].zSum;
      grandPsuCount++;
      grandWeight += pm[c].wSum;
    });
  });
  const grandMeanZ = grandPsuCount > 0 ? grandZSum / grandPsuCount : 0;

  const strataKeys = Object.keys(strataGroups);
  const totalStrata = strataKeys.length;
  const singletonCount = strataKeys.filter(
    sk => Object.keys(strataGroups[sk].psuMap).length === 1
  ).length;

  // --- Guard: is any variance estimable at all? ------------------------------
  if (grandPsuCount <= 1) {
    warnings.push({
      severity: 'error',
      code: 'NO_ESTIMABLE_VARIANCE',
      message: 'No design-based variance can be estimated from this configuration: the '
        + 'sample resolves to a single primary sampling unit. The reported standard error '
        + 'of 0 is not a standard error. Check the Strata and Cluster columns.'
    });
    return {
      estimate, se: 0, cv: 0, ciLower: estimate, ciUpper: estimate, deff: 1.0, warnings
    };
  }

  // --- Guard: does the strata column actually describe a design? -------------
  // A high-cardinality column picked by mistake (an ID, an income, a float) makes almost
  // every stratum a singleton. Under `adjust` that produces a plausible-looking number
  // numerically close to the SRS standard error, which hides the misconfiguration far
  // more effectively than an obvious zero would. Refuse to dress it up.
  let effectivePolicy: LonelyPsuPolicy = lonelyPsuPolicy;
  if (totalStrata > 1 && singletonCount / totalStrata > 0.5) {
    warnings.push({
      severity: 'error',
      code: 'STRATA_COLUMN_LOOKS_WRONG',
      message: `${singletonCount} of ${totalStrata} strata contain a single sampling unit. `
        + 'That pattern means the Strata column is describing something other than the '
        + 'sample design (an identifier or a continuous variable, for example), not that '
        + 'the design has lonely PSUs. No lonely-PSU rule was applied; fix the column '
        + 'selection rather than trusting this standard error.'
    });
    if (effectivePolicy === 'adjust' || effectivePolicy === 'average') {
      effectivePolicy = 'remove';
    }
  }

  // --- Pass A: strata with >= 2 PSUs, and triage of the singletons -----------
  interface LonelyStratum {
    stratum: string;
    z: number;
    fpcMultiplier: number;
    isCertainty: boolean;
    evidence: string;
    wSum: number;
  }
  const lonely: LonelyStratum[] = [];
  let okVarianceSum = 0;
  let okStrataCount = 0;

  strataKeys.forEach(stratum => {
    const grp = strataGroups[stratum];
    const psuKeys = Object.keys(grp.psuMap);
    const n_h = psuKeys.length;

    // --- Finite population correction (computed for ALL strata, singletons too) ---
    // The correction is a single per-stratum quantity carried on every row, so averaging
    // rows is valid only when the value is CONSTANT within the stratum. It is not
    // constant when the declared stratification does not match the design that was drawn
    // -- e.g. a stratified sample analysed with the Strata column left blank collapses
    // unequal f_h into one group and still silently shrinks the variance.
    // R's survey package rejects this outright ("fpc not constant within strata").
    let fpcMultiplier = 1;
    let fMin = Infinity;
    let fMax = -Infinity;
    let fpcCount = 0;
    let fpcAccumulator = 0;

    psuKeys.forEach(c => {
      grp.psuMap[c].fpcList.forEach(f => {
        if (f < fMin) fMin = f;
        if (f > fMax) fMax = f;
        fpcAccumulator += f;
        fpcCount++;
      });
    });

    const avgFpc = fpcCount > 0 ? fpcAccumulator / fpcCount : 0;

    if (fpcCount > 0) {
      if (fMax - fMin > 1e-9) {
        warnings.push({
          severity: 'error',
          code: 'FPC_NOT_CONSTANT_WITHIN_STRATUM',
          message: `Stratum "${stratum}": the finite population correction varies across rows `
            + `(${fMin.toFixed(4)} to ${fMax.toFixed(4)}). It must be a single value per stratum. `
            + `This usually means the Strata Column does not match the design the sample was drawn under. `
            + `No correction was applied for this stratum, so its standard error is conservative.`
        });
      } else if (avgFpc < 0 || avgFpc > 1) {
        warnings.push({
          severity: 'error',
          code: 'FPC_OUT_OF_RANGE',
          message: `Stratum "${stratum}": sampling fraction ${avgFpc.toFixed(4)} is outside [0, 1]. `
            + `A fraction above 1 means the sample size exceeds the population size for this stratum. `
            + `Supply the fraction n/N, not the population size N. No correction was applied.`
        });
      } else {
        fpcMultiplier = 1 - avgFpc;
      }
    }

    if (n_h >= 2) {
      let stratumZSum = 0;
      psuKeys.forEach(c => { stratumZSum += grp.psuMap[c].zSum; });
      const meanZ = stratumZSum / n_h;

      let sumSqDiff = 0;
      psuKeys.forEach(c => {
        sumSqDiff += Math.pow(grp.psuMap[c].zSum - meanZ, 2);
      });

      const contribution = fpcMultiplier * (n_h / (n_h - 1)) * sumSqDiff;
      totalVariance += contribution;
      okVarianceSum += contribution;
      okStrataCount++;
      return;
    }

    // --- Singleton: is it a genuine certainty (take-all) stratum? ---
    // A take-all stratum contributes no sampling variance BY DESIGN, so zero is correct
    // there and an adjustment would overstate. Evidence, in order of authority:
    //   fpc  == 1  -> fully enumerated. Strongest, but deliberately 0 for PPS and WR,
    //                 where 0 means "not applicable", NOT "not certain".
    //   prob == 1  -> inclusion probability of 1. The only signal under PPS, where
    //                 calculatePPSInclusionProbabilities pins certainty units at 1.0.
    const probs: number[] = [];
    psuKeys.forEach(c => { grp.psuMap[c].probList.forEach(pv => probs.push(pv)); });
    const allFpcOne = fpcCount > 0 && fMin >= 1 - 1e-9;
    const usableProbs = probs.filter(pv => Number.isFinite(pv));
    const allProbOne = usableProbs.length === probs.length
      && usableProbs.length > 0
      && usableProbs.every(pv => pv >= 1 - 1e-9);

    let wSum = 0;
    psuKeys.forEach(c => { wSum += grp.psuMap[c].wSum; });

    lonely.push({
      stratum,
      z: grp.psuMap[psuKeys[0]].zSum,
      fpcMultiplier,
      isCertainty: allFpcOne || allProbOne,
      evidence: allFpcOne
        ? 'fpc = 1.0000 (fully enumerated)'
        : allProbOne
          ? 'inclusion probability = 1.0000 (certainty unit)'
          : 'no fpc or prob evidence available',
      wSum
    });
  });

  // --- Pass B: apply the lonely-PSU policy -----------------------------------
  if (lonely.length > 0) {
    const certainty = lonely.filter(l => l.isCertainty);
    const genuine = lonely.filter(l => !l.isCertainty);

    if (certainty.length > 0) {
      warnings.push({
        severity: 'warning',
        code: 'CERTAINTY_STRATUM',
        message: `${certainty.length} stratum/strata were fully enumerated or selected with `
          + `certainty (${certainty.map(l => '"' + l.stratum + '" [' + l.evidence + ']').join(', ')}). `
          + 'They contribute zero sampling variance, which is correct by design. Note that any '
          + 'variance from sub-sampling WITHIN such a unit is not captured by this estimator.'
      });
    }

    if (genuine.length > 0) {
      const affectedWeight = genuine.reduce((acc, l) => acc + l.wSum, 0);
      const weightShare = grandWeight > 0 ? affectedWeight / grandWeight : 0;
      const names = genuine.map(l => '"' + l.stratum + '"').join(', ');
      const materiality = `They hold ${(weightShare * 100).toFixed(1)}% of the total weight, `
        + `across ${genuine.length} of ${totalStrata} strata.`;

      if (effectivePolicy === 'fail') {
        warnings.push({
          severity: 'error',
          code: 'LONELY_PSU_FAIL',
          message: `${names} contain a single sampling unit, so no variance is estimable from `
            + `them. ${materiality} No standard error was produced. Collapse these strata with a `
            + 'neighbour, or choose a different lonely-PSU rule.'
        });
        return { estimate, se: NaN, cv: NaN, ciLower: NaN, ciUpper: NaN, deff: NaN, warnings };
      }

      if (effectivePolicy === 'adjust') {
        // Centre on the grand mean instead of the (degenerate) stratum mean. The
        // n_h/(n_h-1) factor is NOT applied -- it is 1/0 at n_h = 1, and R likewise uses
        // the FPC alone as the scale for a single-PSU stratum.
        genuine.forEach(l => {
          totalVariance += l.fpcMultiplier * Math.pow(l.z - grandMeanZ, 2);
        });
        warnings.push({
          severity: 'error',
          code: 'LONELY_PSU_ADJUSTED',
          message: `${names} contain a single sampling unit. Their variance was estimated by `
            + `centring on the overall mean rather than the stratum mean. ${materiality} `
            + 'This standard error is LARGER than the truth, deliberately: it charges the '
            + 'departure of the stratum from the overall mean to sampling error. Collapsing '
            + 'these strata with a neighbour would give a sharper estimate.'
        });
      } else if (effectivePolicy === 'average') {
        if (okStrataCount === 0) {
          warnings.push({
            severity: 'error',
            code: 'LONELY_PSU_AVERAGE_IMPOSSIBLE',
            message: 'Every stratum contains a single sampling unit, so there is nothing to '
              + `average from. ${materiality} No standard error was produced.`
          });
          return { estimate, se: NaN, cv: NaN, ciLower: NaN, ciUpper: NaN, deff: NaN, warnings };
        }
        const meanContribution = okVarianceSum / okStrataCount;
        totalVariance += meanContribution * genuine.length;
        warnings.push({
          severity: 'error',
          code: 'LONELY_PSU_AVERAGED',
          message: `${names} contain a single sampling unit. Each was assigned the average `
            + `variance contribution of the ${okStrataCount} strata that had two or more. `
            + `${materiality} This assumes the lonely strata behave like the others.`
        });
      } else {
        // 'remove' and 'certainty' both contribute zero for a non-certainty singleton.
        warnings.push({
          severity: 'error',
          code: 'LONELY_PSU_REMOVED',
          message: `${names} contain a single sampling unit and contributed ZERO variance. `
            + `${materiality} This standard error is SMALLER than the truth and the confidence `
            + 'interval is too narrow. Collapse these strata with a neighbour, or use the '
            + '"adjust" rule, before publishing.'
        });
      }
    }
  }

  if (!Number.isFinite(totalVariance)) {
    warnings.push({
      severity: 'error',
      code: 'VARIANCE_NOT_FINITE',
      message: 'The variance computation produced a non-finite value. This is a defect; '
        + 'please report the design and columns used.'
    });
    return { estimate, se: NaN, cv: NaN, ciLower: NaN, ciUpper: NaN, deff: NaN, warnings };
  }

  const se = Math.sqrt(totalVariance);
  const cv = estimate !== 0 ? se / Math.abs(estimate) : 0;
  
  // 95% Confidence Interval (z = 1.96)
  const ciLower = estimate - 1.96 * se;
  const ciUpper = estimate + 1.96 * se;

  // 4. Calculate Design Effect (Deff)
  // Deff = V_complex / V_srs
  // Under SRS: V_srs(Mean) = s_y^2 / n. (Weighted sample variance of Y / n)
  let vSrs = 1.0;
  
  if (type === "mean") {
    let meanY = 0;
    let sumW_srs = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      meanY += w * y;
      sumW_srs += w;
    });
    meanY = sumW_srs > 0 ? meanY / sumW_srs : 0;

    let varY = 0;
    let sumW_minus_1 = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      varY += w * Math.pow(y - meanY, 2);
      sumW_minus_1 += w;
    });
    const s2Y = sumW_minus_1 > 1 ? varY / (sumW_minus_1 - 1) : 0;
    vSrs = s2Y / n;
  } else {
    // For Total: V_srs(Total) = N^2 * s_y^2 / n
    let meanY = 0;
    let sumW_srs = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      meanY += w * y;
      sumW_srs += w;
    });
    meanY = sumW_srs > 0 ? meanY / sumW_srs : 0;

    let varY = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      varY += w * Math.pow(y - meanY, 2);
    });
    const s2Y = sumW_srs > 1 ? varY / (sumW_srs - 1) : 0;
    vSrs = Math.pow(sumW_srs, 2) * (s2Y / n);
  }

  const deff = vSrs > 0 ? totalVariance / vSrs : 1.0;

  return {
    estimate,
    se,
    cv,
    ciLower,
    ciUpper,
    deff,
    warnings
  };
}

export interface BootstrapReplicates {
  replicateWeights: number[][]; // [N][B] matrix of bootstrap weights
  B: number;
}

/**
 * Generate Rao-Wu Stratified Cluster Bootstrap Replicate Weights
 * Resamples clusters (or individual units if no clustering) within each stratum.
 * 
 * @param sample The survey sample array
 * @param B Number of bootstrap replicates (default: 100)
 * @param weightCol Base weight column (after non-response, before raking or full design weight)
 * @param strataCol Optional column for stratification
 * @param clusterCol Optional column for cluster IDs
 * @returns BootstrapReplicates structure containing the N x B weight matrix
 */
export function generateBootstrapWeights(
  sample: any[],
  B = 100,
  weightCol = "weight",
  strataCol?: string,
  clusterCol?: string,
  seed: SeedInput = 0
): BootstrapReplicates {
  const N = sample.length;
  const replicateWeights: number[][] = Array.from({ length: N }, () => Array(B).fill(0));

  if (N === 0) return { replicateWeights, B };

  // 1. Group sample indices by Stratum (and Cluster if present)
  // structure: strataMap[stratumKey][clusterKey] = array of row indices
  const strataMap: Record<string, Record<string, number[]>> = {};

  sample.forEach((row, rowIndex) => {
    const sKey = strataCol ? String(row[strataCol]) : "single";
    const cKey = clusterCol ? String(row[clusterCol]) : `unit_${rowIndex}`;

    if (!strataMap[sKey]) {
      strataMap[sKey] = {};
    }
    if (!strataMap[sKey][cKey]) {
      strataMap[sKey][cKey] = [];
    }
    strataMap[sKey][cKey].push(rowIndex);
  });

  // 2. Perform stratified cluster bootstrap within each stratum independently for each replicate
  for (let b = 0; b < B; b++) {
    Object.keys(strataMap).forEach(stratum => {
      const clusterMap = strataMap[stratum];
      // Sorted so the index -> cluster mapping does not depend on Object.keys()
      // ordering, which V8 reorders for integer-like keys such as bare cluster codes.
      const clusterKeys = Object.keys(clusterMap).sort();
      const n_h = clusterKeys.length; // Number of clusters in stratum

      if (n_h <= 1) {
        // Single PSU in stratum: cannot bootstrap cluster selections.
        // We replicate the original weights (neutral adjustment) to avoid a crash.
        clusterKeys.forEach(cKey => {
          const rowIndices = clusterMap[cKey];
          rowIndices.forEach(idx => {
            const originalW = Number(sample[idx][weightCol]) || 1.0;
            replicateWeights[idx][b] = originalW;
          });
        });
        return;
      }

      // Draw n_h - 1 clusters with replacement
      const drawnClusterCounts: Record<string, number> = {};
      clusterKeys.forEach(k => {
        drawnClusterCounts[k] = 0;
      });

      // One substream per (replicate, stratum), keyed by the stratum's label. This is
      // what makes the replicate weights reproducible: strata with n_h <= 1 return
      // early and consume no draws, so a single shared stream would make every
      // stratum's draws depend on how many lonely strata happened to precede it.
      const repRng = deriveStream(seed, `boot:${b}`, stratum);
      for (let draw = 0; draw < n_h - 1; draw++) {
        const randCluster = clusterKeys[repRng.nextBelow(n_h)];
        drawnClusterCounts[randCluster]++;
      }

      // McCarthy-Snowden / Rao-Wu rescaling factor:
      // f_hi = (n_h / (n_h - 1)) * count_hi
      const scalingConst = n_h / (n_h - 1);

      clusterKeys.forEach(cKey => {
        const count = drawnClusterCounts[cKey];
        const rowIndices = clusterMap[cKey];
        const factor = scalingConst * count;

        rowIndices.forEach(idx => {
          const originalW = Number(sample[idx][weightCol]) || 1.0;
          replicateWeights[idx][b] = originalW * factor;
        });
      });
    });
  }

  return {
    replicateWeights,
    B
  };
}

/**
 * Estimate variance, CV, and design effect of a statistical summary using bootstrap replicate weights.
 * This function calculates replicate-level estimates, incorporating raking or any subsequent adjustments,
 * which yields extremely accurate, design-corrected standard errors.
 * 
 * @param sample The survey sample array
 * @param targetCol Column containing the variable to estimate (e.g. "Income")
 * @param bootWeights Matrix of replicate weights generated by generateBootstrapWeights
 * @param type Estimation type: "mean" or "total"
 * @param fullSampleEstimate The already computed estimate from the full sample (to center calculations)
 */
export function estimateBootstrap(
  sample: any[],
  targetCol: string,
  bootWeights: BootstrapReplicates,
  type: "mean" | "total" = "mean",
  fullSampleEstimate?: number,
  weightCol = "weight"
): EstimationResult {
  const N = sample.length;
  const B = bootWeights.B;

  if (N === 0 || B === 0) {
    return { estimate: 0, se: 0, cv: 0, ciLower: 0, ciUpper: 0, deff: 1.0, warnings: [] };
  }

  // 1. Compute full-sample point estimate if not provided
  let estimate = fullSampleEstimate;
  if (estimate === undefined) {
    let weightedSumY = 0;
    let sumW = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      weightedSumY += w * y;
      sumW += w;
    });
    estimate = type === "mean" ? (sumW > 0 ? weightedSumY / sumW : 0) : weightedSumY;
  }

  // 2. Compute replicate estimates
  const repEstimates: number[] = [];

  for (let b = 0; b < B; b++) {
    let repWeightedSumY = 0;
    let repSumW = 0;

    for (let i = 0; i < N; i++) {
      const y = Number(sample[i][targetCol]) || 0;
      const w = bootWeights.replicateWeights[i][b];
      repWeightedSumY += w * y;
      repSumW += w;
    }

    const repEst = type === "mean" ? (repSumW > 0 ? repWeightedSumY / repSumW : 0) : repWeightedSumY;
    repEstimates.push(repEst);
  }

  // 3. Calculate bootstrap variance
  // V_boot = (1 / B) * sum_b (theta_b - theta_full)^2
  let sumSqDiff = 0;
  for (let b = 0; b < B; b++) {
    sumSqDiff += Math.pow(repEstimates[b] - estimate, 2);
  }
  const variance = sumSqDiff / B;
  const se = Math.sqrt(variance);
  const cv = estimate !== 0 ? se / Math.abs(estimate) : 0;

  // 95% Confidence Interval
  const ciLower = estimate - 1.96 * se;
  const ciUpper = estimate + 1.96 * se;

  // 4. Calculate Design Effect (Deff)
  // Deff = V_complex / V_srs
  let vSrs = 1.0;
  
  if (type === "mean") {
    let meanY = 0;
    let sumW_srs = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      meanY += w * y;
      sumW_srs += w;
    });
    meanY = sumW_srs > 0 ? meanY / sumW_srs : 0;

    let varY = 0;
    let sumW_minus_1 = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      varY += w * Math.pow(y - meanY, 2);
      sumW_minus_1 += w;
    });
    const s2Y = sumW_minus_1 > 1 ? varY / (sumW_minus_1 - 1) : 0;
    vSrs = s2Y / N;
  } else {
    let meanY = 0;
    let sumW_srs = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      meanY += w * y;
      sumW_srs += w;
    });
    meanY = sumW_srs > 0 ? meanY / sumW_srs : 0;

    let varY = 0;
    sample.forEach(row => {
      const y = Number(row[targetCol]) || 0;
      const w = Number(row[weightCol]) || 1.0;
      varY += w * Math.pow(y - meanY, 2);
    });
    const s2Y = sumW_srs > 1 ? varY / (sumW_srs - 1) : 0;
    vSrs = Math.pow(sumW_srs, 2) * (s2Y / N);
  }

  const deff = vSrs > 0 ? variance / vSrs : 1.0;

  return {
    estimate,
    se,
    cv,
    ciLower,
    ciUpper,
    deff,
    // The Rao-Wu bootstrap here is a with-replacement resample of PSUs and applies no
    // finite population correction, so at high sampling fractions it overstates the
    // variance relative to the Taylor estimator. Conservative, but the two engines will
    // disagree and the user should know why.
    warnings: []
  };
}
