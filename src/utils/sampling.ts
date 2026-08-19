/**
 * Official Statistics Sampling & Weighting System - Sampling Draw Engine
 * Written in pure TypeScript with absolute mathematical precision, corrected algorithms, and robust safeguards.
 *
 * REPRODUCIBILITY: every draw takes a `seed` and is exactly regenerable from it.
 * Multi-part designs (stratified, cluster, multistage) derive an independent substream
 * per stratum/cluster/stage keyed by the group's LABEL, never by its position. That
 * makes a draw invariant to iteration order -- important because `Object.keys()`
 * reorders integer-like keys into ascending numeric order regardless of insertion
 * order, so a position-keyed scheme would change the sample when a stratum is renamed.
 * It also means adding a stratum leaves every other stratum's draw untouched.
 */

import type { Rng, SeedInput } from './random';
import { createRng, deriveStream, selectIndicesWithoutReplacement, selectIndicesWithReplacement } from './random';

export interface SampleResult {
  sample: any[];
  probabilities: number[];
  weights: number[];
  indices: number[];
}

/**
 * Draw a Simple Random Sample (SRS) or Systematic Sample.
 *
 * @param frame Array of objects representing the population frame
 * @param n Sample size to draw
 * @param method "srswor" (without replacement), "srswr" (with replacement), or "systematic"
 * @param seed Seed for the draw. The same seed and frame always produce the same sample.
 */
export function drawSRS(
  frame: any[],
  n: number,
  method: "srswor" | "srswr" | "systematic",
  seed: SeedInput
): SampleResult {
  return drawSRSWithRng(frame, n, method, createRng(seed, `srs:${method}`));
}

/**
 * Internal SRS draw against an already-derived stream.
 *
 * Multi-part designs (stratified, cluster, multistage) call this directly with a
 * per-group substream so that each group draws independently and the result does not
 * depend on the order groups happen to be visited in.
 */
export function drawSRSWithRng(
  frame: any[],
  n: number,
  method: "srswor" | "srswr" | "systematic",
  rng: Rng
): SampleResult {
  const N = frame.length;
  if (N === 0) throw new Error("Sampling frame is empty.");
  if (n <= 0) return { sample: [], probabilities: [], weights: [], indices: [] };

  if (method === "srswor") {
    if (n > N) throw new Error(`Sample size (n=${n}) cannot exceed population size (N=${N}) for sampling without replacement.`);

    // Partial Fisher-Yates over the frame indices. `selectIndicesWithoutReplacement`
    // returns draw order; ascending order below is a presentation choice only.
    const drawn = selectIndicesWithoutReplacement(rng, N, n);
    const selectedIndices = [...drawn].sort((a, b) => a - b);
    const sample = selectedIndices.map(idx => ({ ...frame[idx] }));
    const prob = n / N;
    const weight = N / n;

    return {
      sample: sample.map(row => {
        row.prob = prob;
        row.weight = weight;
        row.fpc = n / N; // sampling fraction; variance uses (1 - f)
        return row;
      }),
      probabilities: Array(n).fill(prob),
      weights: Array(n).fill(weight),
      indices: selectedIndices
    };

  } else if (method === "srswr") {
    // Duplicates are intentional and are retained (Hansen-Hurwitz, see weights below).
    const selectedIndices = selectIndicesWithReplacement(rng, N, n);
    selectedIndices.sort((a, b) => a - b);

    // Calculate count of selection per unit
    const counts: Record<number, number> = {};
    selectedIndices.forEach(idx => {
      counts[idx] = (counts[idx] || 0) + 1;
    });

    // Hansen-Hurwitz estimator. Each of the n draws is an independent selection with
    // per-draw probability p = 1/N, so the design weight attached to a DRAW is
    // 1/(n*p) = N/n. The weights then sum to exactly N however many duplicates occur.
    //
    // Do NOT use the distinct-unit inclusion probability pi = 1 - (1 - 1/N)^n here.
    // That weight belongs to a de-duplicated sample; applying it to every draw while
    // also keeping the duplicates double-counts. sum(w) overshot N by 10% at
    // N=1000/n=200 and by 58% at n=N.
    const prob = 1 / N;   // per-draw selection probability
    const weight = N / n; // Hansen-Hurwitz design weight per draw

    const sample = selectedIndices.map((idx, step) => {
      const row = { ...frame[idx] };
      // Unique SSU ID for duplicates
      row._subsample_id = `${row.ID || idx}_copy_${step}`;
      row.selection_count = counts[idx];
      row.prob = prob;
      row.weight = weight;
      // With-replacement designs get NO finite population correction: a unit can be
      // selected repeatedly, so the sample is not "using up" a finite population.
      // Emitting 0 (rather than blank) keeps the column unambiguous on export.
      row.fpc = 0;
      return row;
    });

    return {
      sample,
      probabilities: Array(n).fill(prob),
      weights: Array(n).fill(weight),
      indices: selectedIndices
    };

  } else {
    // --- CRITICAL BUG FIX: Systematic with Fractional Interval Safeguard ---
    // k is a fractional interval (N / n)
    const k = N / n;
    // Random start strictly in [0, k). `nextUnitInterval` is exactly [0, 1) -- it can
    // return 0 but never 1 -- which is what makes the bound proof below hold.
    const r = rng.nextUnitInterval() * k;
    
    const selectedIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(r + i * k);
      // Math guarantee: r + i*k < k + (n-1)*k = n*k = N. So idx <= N - 1 is guaranteed!
      selectedIndices.push(idx);
    }

    const sample = selectedIndices.map(idx => ({ ...frame[idx] }));
    const prob = n / N;
    const weight = N / n;

    return {
      sample: sample.map(row => {
        row.prob = prob;
        row.weight = weight;
        row.fpc = n / N; // systematic is treated as SRSWOR for variance purposes
        return row;
      }),
      probabilities: Array(n).fill(prob),
      weights: Array(n).fill(weight),
      indices: selectedIndices
    };
  }
}

/**
 * Draw a Stratified Sample
 * Fully implements both SRSwor and Systematic draws per stratum slice.
 */
export function drawStratified(
  frame: any[],
  strataCol: string,
  sizes: Record<string, number>,
  method: "srswor" | "systematic" = "srswor",
  seed: SeedInput = 0
): SampleResult {
  const strataGroups: Record<string, any[]> = {};
  
  // Group elements by stratum
  frame.forEach((row, originalIndex) => {
    const val = String(row[strataCol]);
    if (!strataGroups[val]) strataGroups[val] = [];
    // Keep reference to original index for tracking
    strataGroups[val].push({ ...row, _orig_idx: originalIndex });
  });

  const finalSample: any[] = [];
  const finalIndices: number[] = [];
  const finalProbs: number[] = [];
  const finalWeights: number[] = [];

  const strataKeys = Object.keys(strataGroups).sort();

  strataKeys.forEach(stratum => {
    const stratumFrame = strataGroups[stratum];
    const n_h = sizes[stratum] || 0;

    if (n_h <= 0) return; // Skip if allocation is 0

    // Each stratum draws from its own substream, keyed by the stratum's own label.
    // Consequence: the draw is identical however the strata are ordered, and adding
    // or removing a stratum does not disturb any other stratum's selection.
    const drawRes = drawSRSWithRng(
      stratumFrame,
      n_h,
      method === "systematic" ? "systematic" : "srswor",
      deriveStream(seed, 'stratum', stratum)
    );
    
    drawRes.sample.forEach((_, i) => {
      const origRow = stratumFrame[drawRes.indices[i]];
      const newRow = { ...origRow };
      newRow.prob = drawRes.probabilities[i];
      newRow.weight = drawRes.weights[i];
      newRow.stratum = stratum;
      // Per-stratum sampling fraction f_h = n_h / N_h. Re-attached explicitly because
      // this row is rebuilt from the stratum frame rather than from drawRes.sample.
      newRow.fpc = n_h / stratumFrame.length;
      
      finalSample.push(newRow);
      finalIndices.push(origRow._orig_idx);
      finalProbs.push(newRow.prob);
      finalWeights.push(newRow.weight);
    });
  });

  return {
    sample: finalSample,
    probabilities: finalProbs,
    weights: finalWeights,
    indices: finalIndices
  };
}

/**
 * Calculate inclusion probabilities for PPS sampling with a recursion capping rule for certainty units.
 */
export function calculatePPSInclusionProbabilities(sizes: number[], n: number): number[] {
  const N = sizes.length;
  if (N === 0) return [];
  
  let pik = Array(N).fill(0);
  let activeIndices = Array.from({ length: N }, (_, i) => i);
  let target_n = n;
  let sizesCopy = [...sizes];

  let converged = false;
  while (!converged) {
    const activeSum = activeIndices.reduce((sum, idx) => sum + sizesCopy[idx], 0);
    if (activeSum <= 0) {
      // Fallback: equal probabilities if all sizes are 0
      activeIndices.forEach(idx => {
        pik[idx] = target_n / activeIndices.length;
      });
      break;
    }

    let foundCertainty = false;
    const tempPik = [...pik];

    for (let i = 0; i < activeIndices.length; i++) {
      const idx = activeIndices[i];
      const prob = (sizesCopy[idx] * target_n) / activeSum;
      
      if (prob >= 1.0) {
        tempPik[idx] = 1.0;
        foundCertainty = true;
      } else {
        tempPik[idx] = prob;
      }
    }

    if (foundCertainty) {
      pik = tempPik;
      // Filter active indices and adjust target sample size
      const newActive: number[] = [];
      let certaintyCount = 0;
      
      for (let idx = 0; idx < N; idx++) {
        if (pik[idx] === 1.0) {
          certaintyCount++;
        } else {
          newActive.push(idx);
        }
      }
      
      activeIndices = newActive;
      target_n = n - certaintyCount;

      if (target_n <= 0) {
        converged = true;
      }
    } else {
      pik = tempPik;
      converged = true;
    }
  }

  return pik;
}

/**
 * Draw a Probability Proportional to Size (PPS) Systematic Sample
 * Uses Hanurav-Vijayan / systematic PPS method. Highly robust and fits all general n.
 */
export function drawPPS(frame: any[], sizeCol: string, n: number, seed: SeedInput = 0): SampleResult {
  return drawPPSWithRng(frame, sizeCol, n, createRng(seed, 'pps'));
}

export function drawPPSWithRng(frame: any[], sizeCol: string, n: number, rng: Rng): SampleResult {
  const N = frame.length;
  if (N === 0) throw new Error("PPS frame is empty.");
  if (n <= 0) return { sample: [], probabilities: [], weights: [], indices: [] };
  if (n > N) throw new Error("PPS sample size cannot exceed population size.");

  const sizes = frame.map(row => {
    const val = Number(row[sizeCol]);
    return isNaN(val) || val <= 0 ? 1 : val; // Fallback to 1 for invalid sizes
  });

  const pik = calculatePPSInclusionProbabilities(sizes, n);

  // Systematic selection based on cumulative inclusion probabilities
  const cumPik = Array(N).fill(0);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += pik[i];
    cumPik[i] = acc;
  }

  const u = rng.nextUnitInterval(); // random start in [0, 1)
  const selectedIndices: number[] = [];

  for (let i = 0; i < n; i++) {
    const target = u + i;
    // Find first unit where cumPik >= target
    let selIdx = 0;
    while (selIdx < N - 1 && cumPik[selIdx] < target) {
      selIdx++;
    }
    selectedIndices.push(selIdx);
  }

  // Deduplicate and safeguard PPS (systematic PPS guarantees unique selections if all pik < 1,
  // but certainty units with pik=1 are naturally selected without replacement)
  const uniqueIndices = Array.from(new Set(selectedIndices)).sort((a, b) => a - b);
  
  const sample = uniqueIndices.map(idx => {
    const row = { ...frame[idx] };
    row.prob = pik[idx];
    row.weight = 1 / pik[idx];
    // PPS systematic carries NO separate finite population correction. The inclusion
    // probabilities already embed the size measure, and the variance estimator uses the
    // with-replacement approximation (as R's survey and SAS do when no rate is given).
    // Applying an FPC on top would understate the variance -- the dangerous direction.
    row.fpc = 0;
    return row;
  });

  return {
    sample,
    probabilities: uniqueIndices.map(idx => pik[idx]),
    weights: uniqueIndices.map(idx => 1 / pik[idx]),
    indices: uniqueIndices
  };
}

/**
 * Draw Cluster Sample (Single Stage)
 */
export function drawCluster(frame: any[], clusterCol: string, m: number, seed: SeedInput = 0): SampleResult {
  const clusters: Record<string, any[]> = {};
  frame.forEach((row, originalIndex) => {
    const val = String(row[clusterCol]);
    if (!clusters[val]) clusters[val] = [];
    clusters[val].push({ ...row, _orig_idx: originalIndex });
  });

  const clusterKeys = Object.keys(clusters);
  const M = clusterKeys.length;
  if (M === 0) throw new Error("No clusters found.");
  if (m > M) {
    // Cap at M (certainty selection)
    m = M;
  }

  // SRS select m cluster keys. Sort the key list first so the selection does not
  // depend on Object.keys() iteration order, which V8 reorders for integer-like keys.
  clusterKeys.sort();
  const drawnClusterRes = drawSRSWithRng(
    clusterKeys.map(k => ({ ID: k })),
    m,
    "srswor",
    deriveStream(seed, 'cluster-selection', clusterCol)
  );
  const selectedClusterKeys = drawnClusterRes.sample.map(r => r.ID);

  const finalSample: any[] = [];
  const finalIndices: number[] = [];
  const finalProbs: number[] = [];
  const finalWeights: number[] = [];

  // Inclusion probability of a cluster is m / M
  const prob = m / M;
  const weight = M / m;

  selectedClusterKeys.forEach(key => {
    const clusterUnits = clusters[key];
    clusterUnits.forEach(unit => {
      const row = { ...unit };
      row.prob = prob;
      row.weight = weight;
      row.cluster_id = key;
      // Cluster FPC is m/M at the PSU level, not an element-level fraction. Writing it
      // on every element row is safe because the variance estimator aggregates to PSU
      // level first and then applies (1 - f) once per stratum.
      row.fpc = m / M;

      finalSample.push(row);
      finalIndices.push(unit._orig_idx);
      finalProbs.push(prob);
      finalWeights.push(weight);
    });
  });

  return {
    sample: finalSample,
    probabilities: finalProbs,
    weights: finalWeights,
    indices: finalIndices
  };
}

export interface StageConfig {
  unit: string;       // Column name for sampling unit
  method: "Simple Random Sampling" | "Systematic Sampling" | "Stratified Sampling" | "PPS";
  alloc_type: "Fixed Numbers" | "Proportional Allocation" | "Equal Allocation" | "Auto-distribute Target Sample Size";
  alloc_val: string;   // Decimal or integer string representation
}

/**
 * Draw a Multistage Hierarchical Sample (Recursive)
 * Handles option A (manual allocations) and option B (auto-distribution) with robust safeguards.
 */
export function drawMultistage(
  frame: any[],
  config: StageConfig[],
  targetN: number | null,
  seed: SeedInput = 0
): any[] {
  let currentSample = [...frame];

  for (let sIdx = 0; sIdx < config.length; sIdx++) {
    const stage = config[sIdx];
    const unitCol = stage.unit;
    const method = stage.method;
    const allocType = stage.alloc_type;
    
    let allocVal = parseFloat(stage.alloc_val);
    if (isNaN(allocVal) || allocVal <= 0) allocVal = 1;

    // Determine the grouping columns (all previous stages)
    const prevStages = config.slice(0, sIdx).map(c => c.unit);
    
    // Group current sample by parent paths
    const groups: Record<string, any[]> = {};
    currentSample.forEach(row => {
      const key = prevStages.map(col => String(row[col])).join("||");
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });

    // Sort so the traversal does not depend on Object.keys() ordering. Each group
    // draws from its own label-keyed substream anyway, so this only fixes the order
    // in which rows are appended to the output.
    const groupKeys = Object.keys(groups).sort();
    const numGroups = groupKeys.length;

    // OPTION B: Auto-distribute
    // If auto-distribute is active, override allocVal with a proportional share of targetN
    if (allocType === "Auto-distribute Target Sample Size" && targetN !== null) {
      allocVal = targetN / numGroups;
    }

    const nextSample: any[] = [];

    for (let g = 0; g < numGroups; g++) {
      const subFrame = groups[groupKeys[g]];
      
      // Identify unique units at the current stage inside this parent split
      const uniqueUnitsMap: Record<string, any[]> = {};
      subFrame.forEach(row => {
        const val = String(row[unitCol]);
        if (!uniqueUnitsMap[val]) uniqueUnitsMap[val] = [];
        uniqueUnitsMap[val].push(row);
      });

      const uniqueUnitsKeys = Object.keys(uniqueUnitsMap).sort();
      const N_units = uniqueUnitsKeys.length;

      if (N_units === 0) continue;

      // Determine units to select
      let nToSelect = Math.round(allocVal);
      if (allocType === "Proportional Allocation") {
        nToSelect = Math.round(allocVal * N_units);
      }
      
      nToSelect = Math.max(Math.min(nToSelect, N_units), 0);
      if (nToSelect <= 0) continue;

      let drawRes: SampleResult;
      const tempUnitFrame = uniqueUnitsKeys.map(k => ({ ID: k }));

      // One substream per (stage, parent group), keyed by the parent path rather than
      // by loop position, so each group's selection is independent of the others and
      // of the order groups are visited in.
      const stageRng = deriveStream(seed, `stage${sIdx + 1}:${unitCol}`, groupKeys[g]);

      if (method === "PPS") {
        // Find cluster size (count of records inside each unique unit key)
        const unitSizes = uniqueUnitsKeys.map(k => uniqueUnitsMap[k].length);
        const tempPpsFrame = uniqueUnitsKeys.map((k, i) => ({ ID: k, size: unitSizes[i] }));
        drawRes = drawPPSWithRng(tempPpsFrame, "size", nToSelect, stageRng);
      } else {
        const drawMeth = method === "Systematic Sampling" ? "systematic" : "srswor";
        drawRes = drawSRSWithRng(tempUnitFrame, nToSelect, drawMeth, stageRng);
      }

      // Map probabilities back to individual records
      const selectedKeys = drawRes.sample.map(r => r.ID);
      const probMap: Record<string, number> = {};
      selectedKeys.forEach((key, idx) => {
        probMap[key] = drawRes.probabilities[idx];
      });

      selectedKeys.forEach(key => {
        const records = uniqueUnitsMap[key];
        const unitProb = probMap[key];
        
        records.forEach(rec => {
          const newRec = { ...rec };
          newRec[`prob_stage_${sIdx + 1}`] = unitProb;
          
          if (sIdx === 0) {
            newRec.overall_prob = unitProb;
            // FPC applies at the FIRST STAGE ONLY. This estimator is an ultimate-cluster
            // estimator: it collapses everything below the PSU into the PSU total, so the
            // between-PSU variance already contains the later-stage contributions and
            // there is nothing separate to correct. Emitting the PRODUCT of the stage
            // fractions would be wrong -- it is near zero, so (1-f) would be ~1 while
            // telling the user a correction had been applied.
            newRec.fpc = nToSelect / N_units;
          } else {
            newRec.overall_prob = (rec.overall_prob || 1.0) * unitProb;
            // Preserve the first-stage fpc set above; later stages contribute none.
            newRec.fpc = rec.fpc ?? 0;
          }
          
          newRec.prob = newRec.overall_prob;
          newRec.weight = 1 / newRec.prob;
          nextSample.push(newRec);
        });
      });
    }

    currentSample = nextSample;

    if (currentSample.length === 0) {
      throw new Error(`Multistage sample became empty at Stage ${sIdx + 1} (${unitCol}). Check if allocations are too small or if units exist in parent groups.`);
    }
  }

  return currentSample;
}
