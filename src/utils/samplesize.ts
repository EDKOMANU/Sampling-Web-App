/**
 * Official Statistics Sampling & Weighting System - Sample Size & Allocation Engine
 * Written in pure TypeScript with absolute mathematical precision and robust safeguards.
 */

/**
 * Calculate Sample Size using Cochran's Formula for Proportions
 * @param N Population size (optional, for finite population correction)
 * @param p Expected proportion (default: 0.5 for maximum variance)
 * @param e Margin of error (default: 0.05, i.e., +/- 5%)
 * @param z Z-score for target confidence level (default: 1.96 for 95% confidence)
 */
export function calcCochran(N?: number | null, p = 0.5, e = 0.05, z = 1.96): number {
  if (p <= 0 || p >= 1) throw new Error("Expected proportion (p) must be strictly between 0 and 1.");
  if (e <= 0 || e >= 0.5) throw new Error("Margin of error (e) must be strictly between 0 and 0.5.");
  if (z <= 0) throw new Error("Z-score must be greater than 0.");

  const n0 = (Math.pow(z, 2) * p * (1 - p)) / Math.pow(e, 2);
  
  if (N !== undefined && N !== null && !isNaN(N) && N > 0) {
    // Finite population correction (FPC)
    const n = n0 / (1 + ((n0 - 1) / N));
    return Math.ceil(n);
  }
  
  return Math.ceil(n0);
}

/**
 * Calculate Sample Size using Slovin's Formula (or Yamane's Formula)
 * @param N Population size
 * @param e Margin of error
 */
export function calcSlovin(N: number, e = 0.05): number {
  if (!N || N <= 0) throw new Error("Population size (N) must be greater than 0 for Slovin's formula.");
  if (e <= 0 || e >= 0.5) throw new Error("Margin of error (e) must be strictly between 0 and 0.5.");

  const n = N / (1 + N * Math.pow(e, 2));
  return Math.ceil(n);
}

/**
 * Calculate Complex Survey Sample Size
 * Adjusts a baseline simple random sample (SRS) size for cluster design effects and non-response.
 * @param n0 Baseline sample size under simple random sampling (SRS)
 * @param deff Design Effect (multiplier for cluster inflation, default: 1.0)
 * @param rr Expected response rate (0 to 1, default: 1.0)
 */
export function calcComplexSurvey(n0: number, deff = 1.0, rr = 1.0): number {
  if (n0 <= 0) throw new Error("Baseline sample size (n0) must be greater than 0.");
  if (deff < 1.0) throw new Error("Design Effect (Deff) must be at least 1.0.");
  if (rr <= 0 || rr > 1.0) throw new Error("Expected response rate (rr) must be between 0 and 1.0.");

  const n = (n0 * deff) / rr;
  return Math.ceil(n);
}

/**
 * Allocate Sample Size across Strata using the Largest Remainder (Hare-Niemeyer) Rounding Method.
 * Guarantees that allocated integer sample sizes sum EXACTLY to the target sample size `n`.
 * 
 * @param strataSizes Map or Record of population sizes per stratum (e.g., { "North": 12000, "South": 8000 })
 * @param n Total target sample size to allocate
 * @param method Allocation method: "proportional", "equal", or "neyman"
 * @param strataVariances Optional Map/Record of variances per stratum (required for Neyman optimal allocation)
 * @returns A Record of allocated integer sample sizes per stratum
 */
export function allocateStrata(
  strataSizes: Record<string, number>,
  n: number,
  method: "proportional" | "equal" | "neyman" = "proportional",
  strataVariances?: Record<string, number>
): Record<string, number> {
  const strataKeys = Object.keys(strataSizes);
  const k = strataKeys.length;
  
  if (k === 0) return {};
  if (n <= 0) {
    const emptyAlloc: Record<string, number> = {};
    strataKeys.forEach(key => { emptyAlloc[key] = 0; });
    return emptyAlloc;
  }

  const N = strataKeys.reduce((sum, key) => sum + strataSizes[key], 0);
  if (N <= 0) throw new Error("Total population size across all strata must be greater than 0.");

  let exactAllocations: Record<string, number> = {};

  if (method === "equal") {
    // Equal Allocation
    const exactShare = n / k;
    strataKeys.forEach(key => {
      exactAllocations[key] = exactShare;
    });
  } else if (method === "neyman") {
    // Neyman (Optimal) Allocation: n_h = n * (N_h * S_h) / sum(N_h * S_h)
    // S_h is the stratum standard deviation (sqrt of variance)
    const sds: Record<string, number> = {};
    let denom = 0;

    strataKeys.forEach(key => {
      const variance = strataVariances?.[key] ?? 0;
      // If variance is missing or negative, treat it as 0 (safeguard)
      const sd = variance > 0 ? Math.sqrt(variance) : 0;
      sds[key] = sd;
      denom += strataSizes[key] * sd;
    });

    // CRITICAL BUG FIX: Zero-variance guard
    // If denom is 0 (i.e. all variances are 0 or missing), fall back to proportional allocation
    if (denom <= 0) {
      strataKeys.forEach(key => {
        exactAllocations[key] = n * (strataSizes[key] / N);
      });
    } else {
      strataKeys.forEach(key => {
        const num = strataSizes[key] * sds[key];
        exactAllocations[key] = n * (num / denom);
      });
    }
  } else {
    // Proportional Allocation: n_h = n * (N_h / N)
    strataKeys.forEach(key => {
      exactAllocations[key] = n * (strataSizes[key] / N);
    });
  }

  // --- LARGEST REMAINDER METHOD (HARE-NIEMEYER) ---
  // 1. Separate integer parts and remainders
  const allocations: Record<string, number> = {};
  const remainders: { key: string; value: number }[] = [];
  let allocatedSum = 0;

  strataKeys.forEach(key => {
    // Max safeguard: an allocated sample size cannot exceed its stratum population size
    const exact = exactAllocations[key];
    const floorVal = Math.min(Math.floor(exact), strataSizes[key]);
    allocations[key] = floorVal;
    allocatedSum += floorVal;
    remainders.push({ key, value: exact - floorVal });
  });

  // 2. Distribute leftover units to the strata with the largest remainders
  let diff = n - allocatedSum;
  
  if (diff > 0) {
    // Sort remainders in descending order
    remainders.sort((a, b) => b.value - a.value);
    
    for (let i = 0; i < remainders.length && diff > 0; i++) {
      const key = remainders[i].key;
      // Safeguard: make sure we do not exceed the stratum population
      if (allocations[key] < strataSizes[key]) {
        allocations[key]++;
        diff--;
      }
    }
  }

  return allocations;
}
