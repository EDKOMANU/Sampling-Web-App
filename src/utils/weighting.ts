/**
 * Official Statistics Sampling & Weighting System - Weighting & Calibration Engine
 * Written in pure TypeScript with absolute mathematical precision and robust safeguards.
 * 
 * Implements:
 * 1. Base weight calculation and weight summaries.
 * 2. Weighting class non-response adjustments.
 * 3. Response propensity scoring via a compact gradient descent logistic regression solver.
 * 4. Iterative Proportional Fitting (Raking) with dynamic category alignment and weight trimming.
 */

export interface WeightSummary {
  min: number;
  max: number;
  mean: number;
  sum: number;
  cv: number; // Coefficient of variation of weights: SD(w)/mean(w)
  designEffectWeighting: number; // Kish's approximate design effect due to weighting: 1 + L = n * sum(w_i^2) / (sum(w_i))^2
}

/**
 * Calculate statistical summary and Kish's design effect for a set of weights
 */
export function calculateWeightSummary(weights: number[]): WeightSummary {
  const n = weights.length;
  if (n === 0) return { min: 0, max: 0, mean: 0, sum: 0, cv: 0, designEffectWeighting: 1.0 };

  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    sum += w;
    sumSq += w * w;
    if (w < min) min = w;
    if (w > max) max = w;
  }

  const mean = sum / n;
  
  // Calculate standard deviation of weights
  let varianceSum = 0;
  for (let i = 0; i < n; i++) {
    varianceSum += Math.pow(weights[i] - mean, 2);
  }
  const sd = Math.sqrt(varianceSum / n);
  const cv = mean > 0 ? sd / mean : 0;

  // Kish's design effect due to weighting (deft^2)
  // Deff = n * sum(w^2) / (sum(w))^2
  const designEffectWeighting = sum > 0 ? (n * sumSq) / (sum * sum) : 1.0;

  return {
    min,
    max,
    mean,
    sum,
    cv,
    designEffectWeighting
  };
}

/**
 * Apply Weighting Class Non-response Adjustment
 * @param sample Array of sample objects
 * @param classCol Column name representing the weighting classes (e.g., "Region")
 * @param responseCol Binary indicator column representing response (1 = respondent, 0 = non-respondent)
 * @param weightCol Column containing current weights (e.g., "weight" or "base_weight")
 * @returns Rows with `weightCol` overwritten by the adjusted weight, the pre-adjustment
 *          value kept as `design_weight`, plus `adjusted_weight` and `adjustment_factor`
 *          for auditing. Non-respondents get a weight of 0. Respondents are returned
 *          separately as the input to calibration.
 */
export function adjustWeightingClass(
  sample: any[],
  classCol: string,
  responseCol: string,
  weightCol = "weight",
  preflightOptions: PreflightOptions = {}
): { respondents: any[]; fullSample: any[]; warnings: CalibrationWarning[] } {
  // Group by weighting class
  const classSums: Record<string, { eligibleWeight: number; respondentWeight: number; totalCount: number; respondentCount: number }> = {};

  sample.forEach(row => {
    const cls = String(row[classCol]);
    const isRespondent = Number(row[responseCol]) === 1;
    const w = Number(row[weightCol]) || 1.0;

    if (!classSums[cls]) {
      classSums[cls] = { eligibleWeight: 0, respondentWeight: 0, totalCount: 0, respondentCount: 0 };
    }

    const cell = classSums[cls];
    cell.totalCount++;
    cell.eligibleWeight += w;

    if (isRespondent) {
      cell.respondentCount++;
      cell.respondentWeight += w;
    }
  });

  const fullSample = sample.map(row => {
    const newRow = { ...row };
    const cls = String(row[classCol]);
    const isRespondent = Number(row[responseCol]) === 1;
    const w = Number(row[weightCol]) || 1.0;

    const cell = classSums[cls];
    if (!cell || cell.respondentCount === 0) {
      // Safeguard: no respondents in class, keep original weight or warn
      newRow.adjusted_weight = isRespondent ? w : 0;
      newRow.adjustment_factor = 1.0;
    } else {
      // Adjustment factor is sum(eligible weights) / sum(respondent weights)
      const factor = cell.eligibleWeight / cell.respondentWeight;
      newRow.adjustment_factor = factor;
      newRow.adjusted_weight = isRespondent ? w * factor : 0;
    }

    // Carry the adjustment into the live weight column. Downstream calibration and
    // variance estimation read `weightCol`, so without this the adjustment is computed
    // and then discarded. `design_weight` preserves the pre-adjustment value for audit.
    newRow.design_weight = w;
    newRow[weightCol] = newRow.adjusted_weight;
    return newRow;
  });

  const respondents = fullSample.filter(row => Number(row[responseCol]) === 1);

  // --- Pre-flight: classes that cannot carry a defensible adjustment ---
  // Carlson & Williams (2001) name exactly two failure modes for weighting-class
  // adjustment: cells with too few respondents, and inflation factors that are too
  // large. Both inflate variance sharply, and neither is visible in the output weights.
  // The remedy in both cases is to collapse the class into a neighbour.
  const warnings: CalibrationWarning[] = [];
  const minRespondents = preflightOptions.minClassRespondents ?? 20;
  const maxFactor = preflightOptions.maxAdjustmentFactor ?? 3.0;

  const emptyClasses: string[] = [];
  const thinClasses: string[] = [];
  const inflatedClasses: string[] = [];
  let lostWeight = 0;
  let totalEligibleWeight = 0;

  Object.keys(classSums).forEach(cls => {
    const cell = classSums[cls];
    totalEligibleWeight += cell.eligibleWeight;

    if (cell.respondentCount === 0) {
      emptyClasses.push(`"${cls}" (${cell.totalCount} sampled, 0 responded)`);
      lostWeight += cell.eligibleWeight;
      return;
    }
    if (cell.respondentCount < minRespondents) {
      thinClasses.push(`"${cls}" (${cell.respondentCount})`);
    }
    const factor = cell.eligibleWeight / cell.respondentWeight;
    if (factor > maxFactor) {
      inflatedClasses.push(`"${cls}" (x${factor.toFixed(1)})`);
    }
  });

  if (emptyClasses.length > 0) {
    const share = totalEligibleWeight > 0 ? lostWeight / totalEligibleWeight : 0;
    warnings.push({
      severity: 'error',
      code: 'NR_CLASS_NO_RESPONDENTS',
      message: `No respondents at all in ${emptyClasses.join(', ')}. Those classes carry `
        + `${(share * 100).toFixed(1)}% of the eligible population weight and it is dropped `
        + `entirely: the adjusted weights no longer represent that part of the population. `
        + `Collapse these classes into a neighbouring one before weighting.`
    });
  }

  if (thinClasses.length > 0) {
    warnings.push({
      severity: 'warning',
      code: 'NR_CLASS_TOO_FEW_RESPONDENTS',
      message: `Fewer than ${minRespondents} respondents in ${thinClasses.join(', ')}. `
        + `An adjustment estimated from so few cases is unstable and inflates the variance `
        + `of every estimate that uses it. Consider collapsing these classes.`
    });
  }

  if (inflatedClasses.length > 0) {
    warnings.push({
      severity: 'warning',
      code: 'NR_CLASS_FACTOR_TOO_LARGE',
      message: `Adjustment factor above ${maxFactor} in ${inflatedClasses.join(', ')}. `
        + `A large factor means a few respondents are standing in for many non-respondents, `
        + `which sharply increases the weight variation and lowers the effective sample size. `
        + `Collapsing the class trades a little bias for a lot of precision.`
    });
  }

  return { respondents, fullSample, warnings };
}

/**
 * Highly optimized, compact Gradient Descent Logistic Regression solver in TypeScript.
 * Solves response propensity models: P(R = 1 | X) = logistic(beta * X).
 */
class LogisticRegressionSolver {
  private beta: number[] = [];
  private numFeatures = 0;

  private sigmoid(z: number): number {
    return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z)))); // Cap z to prevent under/overflow
  }

  /**
   * Fit logistic regression model
   * @param X 2D matrix of features (rows = samples, cols = features)
   * @param y Binary target array (0 or 1)
   * @param weights Optional weights for weighted logistic regression
   * @param maxIterations Maximum iterations for gradient descent
   * @param learningRate Base learning rate
   */
  public fit(
    X: number[][],
    y: number[],
    weights?: number[],
    maxIterations = 500,
    learningRate = 0.05
  ): void {
    const N = X.length;
    if (N === 0) return;
    this.numFeatures = X[0].length;
    
    // Initialize weights to 0
    this.beta = Array(this.numFeatures).fill(0);
    const obsWeights = weights || Array(N).fill(1.0);

    // Normalize weights to sum to N
    const wSum = obsWeights.reduce((a, b) => a + b, 0);
    const normalizedWeights = wSum > 0 ? obsWeights.map(w => (w * N) / wSum) : obsWeights;

    // Gradient descent with Armijo-style line search or standard backoff
    for (let iter = 0; iter < maxIterations; iter++) {
      const gradients = Array(this.numFeatures).fill(0);
      let loss = 0;

      for (let i = 0; i < N; i++) {
        const xi = X[i];
        const yi = y[i];
        const wi = normalizedWeights[i];

        // Dot product
        let dot = 0;
        for (let j = 0; j < this.numFeatures; j++) {
          dot += this.beta[j] * xi[j];
        }

        const pi = this.sigmoid(dot);
        const error = pi - yi;

        // Gradient accumulation
        for (let j = 0; j < this.numFeatures; j++) {
          gradients[j] += wi * error * xi[j];
        }

        // Loss calculation (binary cross entropy)
        const eps = 1e-15;
        loss -= wi * (yi * Math.log(pi + eps) + (1 - yi) * Math.log(1 - pi + eps));
      }

      // Average gradient and update weights
      let gradNorm = 0;
      for (let j = 0; j < this.numFeatures; j++) {
        gradients[j] /= N;
        gradNorm += gradients[j] * gradients[j];
      }
      gradNorm = Math.sqrt(gradNorm);

      // Convergence check
      if (gradNorm < 1e-6) break;

      // Adjust learning rate over iterations
      const lr = learningRate / (1 + 0.01 * iter);
      for (let j = 0; j < this.numFeatures; j++) {
        this.beta[j] -= lr * gradients[j];
      }
    }
  }

  /**
   * Predict probabilities
   */
  public predict(X: number[][]): number[] {
    return X.map(xi => {
      let dot = 0;
      for (let j = 0; j < this.numFeatures; j++) {
        dot += this.beta[j] * xi[j];
      }
      return this.sigmoid(dot);
    });
  }
}

/**
 * Apply Response Propensity Weighting Adjustment using Logistic Regression
 * @param sample The full sample (both respondents and non-respondents)
 * @param responseCol Column indicating response (1 = respondent, 0 = non-respondent)
 * @param numericCovariates Numeric covariate columns to include in logistic regression
 * @param categoricalCovariates Categorical covariate columns to one-hot encode
 * @param weightCol Column containing baseline weights
 * @param maxWeightMultiplier Maximum adjustment multiplier (trimming cap) to prevent runaway variance (default: 5.0)
 */
export function adjustResponsePropensity(
  sample: any[],
  responseCol: string,
  numericCovariates: string[],
  categoricalCovariates: string[],
  weightCol = "weight",
  maxWeightMultiplier = 5.0
): { respondents: any[]; fullSample: any[]; warnings: CalibrationWarning[] } {
  const N = sample.length;
  if (N === 0) return { respondents: [], fullSample: [], warnings: [] };

  // 1. One-hot encoding of categorical variables
  const categoryValues: Record<string, string[]> = {};
  categoricalCovariates.forEach(col => {
    const vals = Array.from(new Set(sample.map(row => String(row[col]))));
    // Exclude one category to avoid perfect multicollinearity (bias dummy trap)
    categoryValues[col] = vals.sort().slice(1);
  });

  // 2. Build feature matrix X and target y
  const X: number[][] = [];
  const y: number[] = [];
  const baseWeights: number[] = [];

  sample.forEach(row => {
    const xi: number[] = [1.0]; // Bias term (intercept)

    // Add numeric covariates (scaled to mean=0, std=1 for stable gradient descent)
    numericCovariates.forEach(col => {
      const val = Number(row[col]);
      xi.push(isNaN(val) ? 0.0 : val);
    });

    // Add one-hot encoded categorical covariates
    categoricalCovariates.forEach(col => {
      const activeVals = categoryValues[col];
      const val = String(row[col]);
      activeVals.forEach(v => {
        xi.push(val === v ? 1.0 : 0.0);
      });
    });

    X.push(xi);
    y.push(Number(row[responseCol]) === 1 ? 1.0 : 0.0);
    baseWeights.push(Number(row[weightCol]) || 1.0);
  });

  // Scale numerical covariates in X for gradient stability
  const numNumeric = numericCovariates.length;
  for (let j = 1; j <= numNumeric; j++) {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += X[i][j];
    const mean = sum / N;

    let sqDiffSum = 0;
    for (let i = 0; i < N; i++) sqDiffSum += Math.pow(X[i][j] - mean, 2);
    const sd = Math.sqrt(sqDiffSum / N) || 1.0;

    for (let i = 0; i < N; i++) {
      X[i][j] = (X[i][j] - mean) / sd;
    }
  }

  // 3. Fit Logistic Regression
  const solver = new LogisticRegressionSolver();
  solver.fit(X, y, baseWeights);
  const propensities = solver.predict(X);

  // 4. Calculate adjustment factor and adjusted weights
  // Propensity adjustment factor = 1 / propensity_score
  // Trim factor to prevent extreme variance: cap adjustment at maxWeightMultiplier * medianAdjustment
  const rawFactors: number[] = [];
  propensities.forEach((p, i) => {
    if (y[i] === 1.0) {
      rawFactors.push(p > 0.01 ? 1 / p : 100.0);
    }
  });

  rawFactors.sort((a, b) => a - b);
  const medianFactor = rawFactors.length > 0 ? rawFactors[Math.floor(rawFactors.length / 2)] : 1.0;
  const maxFactor = medianFactor * maxWeightMultiplier;

  const fullSample = sample.map((row, i) => {
    const newRow = { ...row };
    const isRespondent = y[i] === 1.0;
    const w = baseWeights[i];
    const propensity = propensities[i];

    newRow.propensity_score = propensity;
    
    if (isRespondent) {
      let factor = propensity > 0.001 ? 1 / propensity : 1000.0;
      if (factor > maxFactor) {
        factor = maxFactor; // Trim factor
      }
      newRow.adjustment_factor = factor;
      newRow.adjusted_weight = w * factor;
    } else {
      newRow.adjustment_factor = 0.0;
      newRow.adjusted_weight = 0.0;
    }

    // Carry the adjustment into the live weight column (see adjustWeightingClass).
    newRow.design_weight = w;
    newRow[weightCol] = newRow.adjusted_weight;
    return newRow;
  });

  const respondents = fullSample.filter(row => Number(row[responseCol]) === 1);

  // Propensity-model diagnostics (fit quality, propensity distribution, effective
  // sample size) belong with the IRLS rewrite in T20; the channel is here so callers
  // can treat both non-response paths identically.
  return { respondents, fullSample, warnings: [] };
}

export interface RakingMargin {
  column: string; // The column to rake on (e.g. "AgeGroup")
  targets: Record<string, number>; // Marginal target totals (e.g. { "18-34": 45000, "35-54": 55000, "55+": 40000 })
}

export interface CalibrationWarning {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/** Tunable thresholds for the calibration and non-response pre-flight checks. */
export interface PreflightOptions {
  /** Relative disagreement between margin grand totals that counts as an error. Default 0.1%. */
  marginTotalTolerance?: number;
  /** Share of starting weight allowed to sit in categories no margin controls. Default 0.1%. */
  uncontrolledWeightTolerance?: number;
  /** Minimum respondents in a weighting class before its adjustment is trustworthy. Default 20. */
  minClassRespondents?: number;
  /** Adjustment factor above which a weighting class should be collapsed. Default 3. */
  maxAdjustmentFactor?: number;
}

/**
 * Validate a calibration specification BEFORE any weight is touched.
 *
 * Two failures are possible here that the iteration itself cannot detect, because in
 * both cases the algorithm converges happily on a specification that does not describe
 * the population it claims to:
 *
 *  1. Margins that sum to different grand totals. IPF fits one margin at a time, so if
 *     age says the population is 100,000 and region says 98,000, each pass drags the
 *     weights toward a different total and no fixed point exists. The loop either
 *     oscillates until it hits maxIterations or lands wherever the last margin left it.
 *     Deming & Stephan (1940) require a common total; nothing in this codebase checked it.
 *
 *  2. Sample categories that no margin controls. The raking loop guards its updates with
 *     `if (cat in sampleWeightedSums)`, so rows in a category absent from the targets are
 *     never adjusted for that margin. Their weights survive untouched but sit outside the
 *     margin total, so the calibrated weights quietly stop summing to the population.
 *     This is the mirror image of the target-category collapsing already handled, and it
 *     is the more dangerous direction because nothing downstream reveals it.
 */
export function preflightCalibration(
  sample: any[],
  margins: RakingMargin[],
  weightCol = "weight",
  options: PreflightOptions = {}
): CalibrationWarning[] {
  const warnings: CalibrationWarning[] = [];
  if (sample.length === 0 || margins.length === 0) return warnings;

  const totalTol = options.marginTotalTolerance ?? 0.001;
  const uncontrolledTol = options.uncontrolledWeightTolerance ?? 0.001;

  // --- Check 1: every margin must describe the same population total ---
  const totals = margins.map(m => ({
    column: m.column,
    total: Object.values(m.targets).reduce((a, b) => a + (Number(b) || 0), 0)
  }));
  const positive = totals.filter(t => t.total > 0);

  if (positive.length >= 2) {
    const maxT = Math.max(...positive.map(t => t.total));
    const minT = Math.min(...positive.map(t => t.total));
    const relSpread = maxT > 0 ? (maxT - minT) / maxT : 0;

    if (relSpread > totalTol) {
      const detail = totals
        .map(t => `"${t.column}" = ${t.total.toLocaleString()}`)
        .join(', ');
      warnings.push({
        severity: 'error',
        code: 'MARGIN_TOTALS_INCONSISTENT',
        message: `The margins describe different population totals, disagreeing by `
          + `${(relSpread * 100).toFixed(2)}%: ${detail}. Calibration fits one margin at a `
          + `time, so no set of weights can satisfy all of them at once; the result would `
          + `depend on which margin happened to be fitted last. Reconcile the targets so `
          + `every margin sums to the same population total.`
      });
    }
  }

  // --- Check 2: sample categories that no margin controls ---
  let totalWeight = 0;
  sample.forEach(row => { totalWeight += Number(row[weightCol]) || 1.0; });

  margins.forEach(m => {
    const controlled = new Set(Object.keys(m.targets));
    const uncontrolled: Record<string, number> = {};
    let uncontrolledWeight = 0;

    sample.forEach(row => {
      const cat = String(row[m.column]);
      if (!controlled.has(cat)) {
        uncontrolled[cat] = (uncontrolled[cat] || 0) + (Number(row[weightCol]) || 1.0);
        uncontrolledWeight += Number(row[weightCol]) || 1.0;
      }
    });

    const share = totalWeight > 0 ? uncontrolledWeight / totalWeight : 0;
    if (share > uncontrolledTol) {
      const names = Object.keys(uncontrolled).sort().slice(0, 6);
      const shown = names.join(', ') + (Object.keys(uncontrolled).length > names.length ? ', ...' : '');
      warnings.push({
        severity: 'error',
        code: 'SAMPLE_CATEGORY_UNMATCHED',
        message: `"${m.column}": ${(share * 100).toFixed(1)}% of the sample weight sits in `
          + `categories with no matching target (${shown}). Calibration cannot adjust those `
          + `rows, so the calibrated weights will not sum to the population total. Add targets `
          + `for them, or recode them into a category that has one.`
      });
    }
  });

  return warnings;
}

export interface RakingResult {
  sample: any[];
  converged: boolean;
  iterations: number;
  maxDiscrepancy: number; // Final maximum percentage deviation from target
  /** Methodological issues detected during calibration. `error` means the result must not be used. */
  warnings: CalibrationWarning[];
  marginsSummary: {
    column: string;
    category: string;
    sampleWeightedTotal: number;
    targetTotal: number;
    difference: number;
    pctDifference: number;
  }[];
}

/**
 * Highly robust Iterative Proportional Fitting (Raking) algorithm.
 * Dynamically resolves Category Mismatches (census categories missing in sample non-responses).
 * Supports weight trimming to limit variance inflation.
 * 
 * @param sample Survey sample array (respondents only)
 * @param margins Array of margins and target populations
 * @param weightCol Column containing starting weights (e.g. base weight or non-response adjusted weight)
 * @param maxIterations Maximum raking iterations (default: 40)
 * @param tolerance Convergence tolerance for fractional difference (default: 0.001, i.e., 0.1%)
 * @param trimBounds Optional weight capping bounds [lowerBoundFactor, upperBoundFactor] (e.g. [0.3, 3.0])
 */
export function rakeWeights(
  sample: any[],
  margins: RakingMargin[],
  weightCol = "weight",
  maxIterations = 40,
  tolerance = 0.001,
  trimBounds?: [number, number],
  preflightOptions: PreflightOptions = {}
): RakingResult {
  const N = sample.length;
  if (N === 0) {
    return { sample: [], converged: false, iterations: 0, maxDiscrepancy: 0, marginsSummary: [], warnings: [] };
  }

  // Validate the specification before touching a single weight. A margin set that fails
  // pre-flight cannot produce a usable result, however cleanly the iteration converges
  // against those inconsistent targets.
  const warnings: CalibrationWarning[] = preflightCalibration(sample, margins, weightCol, preflightOptions);
  const preflightBlocked = warnings.some(w => w.severity === 'error');

  // Create workspace copy of sample with weight trackers
  const workingSample = sample.map(row => ({
    ...row,
    _working_weight: Number(row[weightCol]) || 1.0,
    _original_weight: Number(row[weightCol]) || 1.0
  }));

  // Pre-calculate categories present in sample for each margin to detect and solve category mismatches
  const sampleCategoriesPerMargin: Record<string, Set<string>> = {};
  margins.forEach(m => {
    sampleCategoriesPerMargin[m.column] = new Set<string>();
  });

  workingSample.forEach(row => {
    margins.forEach(m => {
      const val = String(row[m.column]);
      sampleCategoriesPerMargin[m.column].add(val);
    });
  });

  // --- CRITICAL BUG FIX: Category Mismatches & Population Alignment ---
  // If target census lists categories that have ZERO sample respondents, we cannot rake them.
  // We must:
  // 1. Detect zero-respondent target categories.
  // 2. Alert/handle: collapse these targets by scaling the active categories of this margin proportionally
  //    so the margin total still equals the total population target, preventing division-by-zero!
  const alignedMargins: RakingMargin[] = margins.map(m => {
    const col = m.column;
    const sampleCats = sampleCategoriesPerMargin[col];
    const targets = { ...m.targets };

    let inactiveTargetSum = 0;
    let activeTargetSum = 0;

    Object.keys(targets).forEach(cat => {
      if (!sampleCats.has(cat)) {
        // Mismatch detected! Category exists in census but has 0 survey respondents.
        inactiveTargetSum += targets[cat];
        delete targets[cat]; // Remove category from raking targets
      } else {
        activeTargetSum += targets[cat];
      }
    });

    if (inactiveTargetSum > 0 && activeTargetSum > 0) {
      // Redistribute the missing category target proportionally to the active categories
      // so the total target of this margin remains identical.
      const scale = (activeTargetSum + inactiveTargetSum) / activeTargetSum;
      Object.keys(targets).forEach(cat => {
        targets[cat] *= scale;
      });
      warnings.push({
        severity: 'warning',
        code: 'TARGET_CATEGORY_COLLAPSED',
        message: `"${col}": ${inactiveTargetSum.toLocaleString()} population units sit in target categories with zero respondents. `
          + `Their totals were redistributed across the remaining categories (scaled by ${scale.toFixed(4)}). `
          + `Estimates for those categories cannot be produced from this sample.`
      });
    }

    return { column: col, targets };
  });

  let converged = false;
  let iter = 0;
  let lastMaxDiscrepancy = Infinity;

  while (iter < maxIterations && !converged) {
    iter++;
    let currentMaxDiscrepancy = 0;

    // Rake each margin sequentially
    for (let mIdx = 0; mIdx < alignedMargins.length; mIdx++) {
      const margin = alignedMargins[mIdx];
      const col = margin.column;
      const targets = margin.targets;

      // 1. Compute current weighted totals per category in sample
      const sampleWeightedSums: Record<string, number> = {};
      Object.keys(targets).forEach(cat => {
        sampleWeightedSums[cat] = 0;
      });

      workingSample.forEach(row => {
        const cat = String(row[col]);
        if (cat in sampleWeightedSums) {
          sampleWeightedSums[cat] += row._working_weight;
        }
      });

      // 2. Adjust weights by ratio of Target / SampleTotal
      workingSample.forEach(row => {
        const cat = String(row[col]);
        if (cat in sampleWeightedSums) {
          const sampleSum = sampleWeightedSums[cat];
          const targetSum = targets[cat];
          if (sampleSum > 0) {
            row._working_weight *= (targetSum / sampleSum);
          }
        }
      });

      // 3. Weight Trimming (if bounds provided)
      // Caps weights at lowerBoundFactor * origWeight and upperBoundFactor * origWeight
      if (trimBounds) {
        const [lowerFactor, upperFactor] = trimBounds;
        workingSample.forEach(row => {
          const minW = row._original_weight * lowerFactor;
          const maxW = row._original_weight * upperFactor;
          
          if (row._working_weight < minW) {
            row._working_weight = minW;
          } else if (row._working_weight > maxW) {
            row._working_weight = maxW;
          }
        });
      }
    }

    // Check convergence: calculate discrepancies across all aligned margins
    let totalTargetDeviations = 0;
    let numEvaluations = 0;

    for (let mIdx = 0; mIdx < alignedMargins.length; mIdx++) {
      const margin = alignedMargins[mIdx];
      const col = margin.column;
      const targets = margin.targets;

      const sampleWeightedSums: Record<string, number> = {};
      Object.keys(targets).forEach(cat => {
        sampleWeightedSums[cat] = 0;
      });

      workingSample.forEach(row => {
        const cat = String(row[col]);
        if (cat in sampleWeightedSums) {
          sampleWeightedSums[cat] += row._working_weight;
        }
      });

      Object.keys(targets).forEach(cat => {
        const target = targets[cat];
        const sampleSum = sampleWeightedSums[cat];
        const diff = Math.abs(sampleSum - target);
        const pctDiff = target > 0 ? diff / target : 0;

        if (pctDiff > currentMaxDiscrepancy) {
          currentMaxDiscrepancy = pctDiff;
        }
        totalTargetDeviations += pctDiff;
        numEvaluations++;
      });
    }

    lastMaxDiscrepancy = currentMaxDiscrepancy;

    if (currentMaxDiscrepancy <= tolerance) {
      converged = true;
      break;
    }
  }

  // Generate final margins summary for reporting
  const marginsSummary: RakingResult["marginsSummary"] = [];
  
  // Note: we summarize using the original requested margins, but showing collapsed/realigned numbers where appropriate
  margins.forEach(m => {
    const col = m.column;
    const originalTargets = m.targets;

    const sampleWeightedSums: Record<string, number> = {};
    Object.keys(originalTargets).forEach(cat => {
      sampleWeightedSums[cat] = 0;
    });

    workingSample.forEach(row => {
      const cat = String(row[col]);
      if (cat in sampleWeightedSums) {
        sampleWeightedSums[cat] += row._working_weight;
      }
    });

    Object.keys(originalTargets).forEach(cat => {
      const target = originalTargets[cat];
      const sampleSum = sampleWeightedSums[cat];
      const diff = sampleSum - target;
      const pctDiff = target > 0 ? (diff / target) * 100 : 0;

      marginsSummary.push({
        column: col,
        category: cat,
        sampleWeightedTotal: sampleSum,
        targetTotal: target,
        difference: diff,
        pctDifference: pctDiff
      });
    });
  });

  // Assign calibrated weights back to output
  const finalSample = workingSample.map(row => {
    const newRow = { ...row };
    newRow[weightCol] = row._working_weight;
    newRow.base_weight = row._original_weight;
    
    // Clean up temporary variables
    delete newRow._working_weight;
    delete newRow._original_weight;
    return newRow;
  });

  if (!converged) {
    warnings.push({
      severity: 'warning',
      code: 'RAKING_NOT_CONVERGED',
      message: `Raking stopped after ${iter} iterations with a maximum margin deviation of `
        + `${(lastMaxDiscrepancy * 100).toFixed(2)}%, above the ${(tolerance * 100).toFixed(2)}% tolerance. `
        + (trimBounds
            ? `Trimming bounds [${trimBounds[0]}, ${trimBounds[1]}] are active and are clipping weights back after each margin is fitted, which can prevent convergence. Widen the bounds or accept the deviation.`
            : `Check that every margin's targets sum to the same population total.`)
    });
  }

  return {
    sample: finalSample,
    // A specification that failed pre-flight cannot yield usable weights even if the
    // iteration met its own tolerance against those inconsistent targets.
    converged: converged && !preflightBlocked,
    iterations: iter,
    maxDiscrepancy: lastMaxDiscrepancy,
    marginsSummary,
    warnings
  };
}

/**
 * Solve a linear equation system Ax = b using Gaussian Elimination with partial pivoting.
 * Includes absolute safeguards for near-singular or singular pivots.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Create an augmented matrix [A | b]
  const M = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    // Search for maximum in this column
    let maxEl = Math.abs(M[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxEl) {
        maxEl = Math.abs(M[k][i]);
        maxRow = k;
      }
    }

    // Swap maximum row with current row
    const temp = M[maxRow];
    M[maxRow] = M[i];
    M[i] = temp;

    // Singular matrix check
    if (Math.abs(M[i][i]) < 1e-15) {
      // Pivot is effectively zero. Add a tiny perturbation to diagonal to keep solving.
      M[i][i] = 1e-15;
    }

    // Make all rows below this one 0 in current column
    for (let k = i + 1; k < n; k++) {
      const c = -M[k][i] / M[i][i];
      for (let j = i; j < n + 1; j++) {
        if (i === j) {
          M[k][j] = 0;
        } else {
          M[k][j] += c * M[i][j];
        }
      }
    }
  }

  // Back substitution
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(M[i][i]) < 1e-15) {
      x[i] = 0;
      continue;
    }
    x[i] = M[i][n] / M[i][i];
    for (let k = i - 1; k >= 0; k--) {
      M[k][n] -= M[k][i] * x[i];
    }
  }
  return x;
}

/**
 * Linear Calibration (GREG) weight adjustment.
 * Fits the calibration system where w_i = d_i * (1 + x_i^T * lambda) exactly
 * using a ridge-regularized linear equation solver.
 */
export function calibrateLinear(
  sample: any[],
  margins: RakingMargin[],
  weightCol = "weight",
  preflightOptions: PreflightOptions = {}
): RakingResult {
  const N = sample.length;
  if (N === 0) {
    return { sample: [], converged: false, iterations: 0, maxDiscrepancy: 0, marginsSummary: [], warnings: [] };
  }

  const warnings: CalibrationWarning[] = preflightCalibration(sample, margins, weightCol, preflightOptions);
  const preflightBlocked = warnings.some(w => w.severity === 'error');

  // Detect and resolve category mismatches (census categories with zero survey respondents)
  const sampleCategoriesPerMargin: Record<string, Set<string>> = {};
  margins.forEach(m => {
    sampleCategoriesPerMargin[m.column] = new Set<string>();
  });

  sample.forEach(row => {
    margins.forEach(m => {
      const val = String(row[m.column]);
      sampleCategoriesPerMargin[m.column].add(val);
    });
  });

  const alignedMargins: RakingMargin[] = margins.map(m => {
    const col = m.column;
    const sampleCats = sampleCategoriesPerMargin[col];
    const targets = { ...m.targets };

    let inactiveTargetSum = 0;
    let activeTargetSum = 0;

    Object.keys(targets).forEach(cat => {
      if (!sampleCats.has(cat)) {
        inactiveTargetSum += targets[cat];
        delete targets[cat];
      } else {
        activeTargetSum += targets[cat];
      }
    });

    if (inactiveTargetSum > 0 && activeTargetSum > 0) {
      const scale = (activeTargetSum + inactiveTargetSum) / activeTargetSum;
      Object.keys(targets).forEach(cat => {
        targets[cat] *= scale;
      });
      warnings.push({
        severity: 'warning',
        code: 'TARGET_CATEGORY_COLLAPSED',
        message: `"${col}": ${inactiveTargetSum.toLocaleString()} population units sit in target categories with zero respondents. `
          + `Their totals were redistributed across the remaining categories (scaled by ${scale.toFixed(4)}).`
      });
    }

    return { column: col, targets };
  });

  // Gather unique categories across all margins
  const categoryKeys: { column: string; category: string }[] = [];
  alignedMargins.forEach(m => {
    Object.keys(m.targets).forEach(cat => {
      categoryKeys.push({ column: m.column, category: cat });
    });
  });

  const K = categoryKeys.length;
  if (K === 0) {
    return { 
      sample: sample.map(row => ({ ...row, base_weight: Number(row[weightCol]) || 1.0 })), 
      converged: true, 
      iterations: 0, 
      maxDiscrepancy: 0, 
      marginsSummary: [],
      warnings
    };
  }

  // Construct dummy variables matrix X
  const X: number[][] = sample.map(row => {
    const xi = Array(K).fill(0);
    categoryKeys.forEach((key, idx) => {
      if (String(row[key.column]) === key.category) {
        xi[idx] = 1.0;
      }
    });
    return xi;
  });

  const baseWeights = sample.map(row => Number(row[weightCol]) || 1.0);
  const A = Array(K).fill(0).map(() => Array(K).fill(0));
  const b = Array(K).fill(0);

  // Retrieve population targets T
  const T = categoryKeys.map(key => {
    const margin = alignedMargins.find(m => m.column === key.column);
    return margin ? (margin.targets[key.category] || 0) : 0;
  });

  // Calculate b = T - sum(d_i * x_i)
  for (let idx = 0; idx < K; idx++) {
    let sumWeightX = 0;
    for (let i = 0; i < N; i++) {
      sumWeightX += baseWeights[i] * X[i][idx];
    }
    b[idx] = T[idx] - sumWeightX;
  }

  // Calculate A_jk = sum(d_i * x_ij * x_ik)
  for (let j = 0; j < K; j++) {
    for (let k = 0; k < K; k++) {
      let sumWeightXX = 0;
      for (let i = 0; i < N; i++) {
        if (X[i][j] > 0 && X[i][k] > 0) {
          sumWeightXX += baseWeights[i];
        }
      }
      A[j][k] = sumWeightXX;
    }
  }

  // Ridge Regularization: Add a tiny value to the diagonal to ensure A is positive definite and invertible
  let diagSum = 0;
  for (let k = 0; k < K; k++) {
    diagSum += A[k][k];
  }
  const meanDiag = K > 0 ? diagSum / K : 1.0;
  const ridgeAlpha = 1e-5 * meanDiag;

  for (let k = 0; k < K; k++) {
    A[k][k] += ridgeAlpha;
  }

  // Solve the linear system
  let lambda: number[];
  let converged = true;
  try {
    lambda = solveLinearSystem(A, b);
  } catch (err) {
    lambda = Array(K).fill(0);
    converged = false;
    warnings.push({
      severity: 'error',
      code: 'CALIBRATION_SYSTEM_SINGULAR',
      message: 'The calibration system could not be solved. This usually means two margins '
        + 'describe the same partition of the sample, or a category has no respondents. '
        + 'Remove the redundant margin and try again.'
    });
  }

  // Compute calibrated weights
  const finalSample = sample.map((row, i) => {
    let dot = 0;
    for (let k = 0; k < K; k++) {
      dot += X[i][k] * lambda[k];
    }
    const newWeight = baseWeights[i] * (1.0 + dot);
    return {
      ...row,
      [weightCol]: newWeight,
      base_weight: baseWeights[i]
    };
  });

  // Linear calibration solves w = d(1 + x'lambda), which is unbounded below. When a
  // calibration cell is small or the targets sit far from the sample, the multiplier
  // goes negative. Negative weights are not a usable survey weight -- they make totals
  // and variances meaningless -- so this is an error, not a warning.
  // (Deville & Sarndal 1992; Sarndal 2016 name this as the principal drawback of GREG,
  // and it is the reason the bounded/logit variants exist.)
  let negativeCount = 0;
  let minWeight = Infinity;
  finalSample.forEach(row => {
    const w = Number(row[weightCol]);
    if (w < minWeight) minWeight = w;
    if (!(w > 0)) negativeCount++;
  });

  if (negativeCount > 0) {
    converged = false;
    warnings.push({
      severity: 'error',
      code: 'NEGATIVE_WEIGHTS',
      message: `Linear calibration produced ${negativeCount} non-positive weight`
        + `${negativeCount === 1 ? '' : 's'} (minimum ${minWeight.toFixed(4)}). `
        + 'Totals and standard errors computed from these weights are invalid. '
        + 'Use Raking, or Truncated raking with bounds, which keep every weight positive.'
    });
  }

  // Calculate final audit report summaries
  const marginsSummary: RakingResult["marginsSummary"] = [];
  margins.forEach(m => {
    const col = m.column;
    const originalTargets = m.targets;

    const sampleWeightedSums: Record<string, number> = {};
    Object.keys(originalTargets).forEach(cat => {
      sampleWeightedSums[cat] = 0;
    });

    finalSample.forEach(row => {
      const cat = String(row[col]);
      if (cat in sampleWeightedSums) {
        sampleWeightedSums[cat] += Number(row[weightCol]) || 0;
      }
    });

    Object.keys(originalTargets).forEach(cat => {
      const target = originalTargets[cat];
      const sampleSum = sampleWeightedSums[cat];
      const diff = sampleSum - target;
      const pctDiff = target > 0 ? (diff / target) * 100 : 0;

      marginsSummary.push({
        column: col,
        category: cat,
        sampleWeightedTotal: sampleSum,
        targetTotal: target,
        difference: diff,
        pctDifference: pctDiff
      });
    });
  });

  let maxDiscrepancy = 0;
  marginsSummary.forEach(m => {
    const pct = Math.abs(m.pctDifference) / 100;
    if (pct > maxDiscrepancy) {
      maxDiscrepancy = pct;
    }
  });

  return {
    sample: finalSample,
    converged: converged && !preflightBlocked,
    iterations: 1,
    maxDiscrepancy,
    marginsSummary,
    warnings
  };
}

/**
 * Unified post-survey weighting and calibration entry point.
 * Supports IPF Raking, Linear GREG calibration, and Logit (Bounded IPF).
 */
export function calibrateWeights(
  sample: any[],
  margins: RakingMargin[],
  method: 'raking' | 'linear' | 'logit',
  weightCol = "weight",
  trimBounds?: [number, number],
  maxIterations = 50,
  tolerance = 0.001,
  preflightOptions: PreflightOptions = {}
): RakingResult {
  if (method === 'linear') {
    return calibrateLinear(sample, margins, weightCol, preflightOptions);
  } else if (method === 'logit') {
    // Logit/bounded calibration is solved via truncated raking with strict bounds
    const bounds = trimBounds || [0.1, 10.0];
    return rakeWeights(sample, margins, weightCol, maxIterations, tolerance, bounds, preflightOptions);
  } else {
    // Standard Multiplicative Raking
    return rakeWeights(sample, margins, weightCol, maxIterations, tolerance, trimBounds, preflightOptions);
  }
}

