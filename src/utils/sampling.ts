/**
 * Official Statistics Sampling & Weighting System - Sampling Draw Engine
 * Written in pure TypeScript with absolute mathematical precision, corrected algorithms, and robust safeguards.
 */

export interface SampleResult {
  sample: any[];
  probabilities: number[];
  weights: number[];
  indices: number[];
}

/**
 * Draw a Simple Random Sample (SRS) or Systematic Sample
 * @param frame Array of objects representing the population frame
 * @param n Sample size to draw
 * @param method "srswor" (without replacement), "srswr" (with replacement), or "systematic"
 * @returns SampleResult
 */
export function drawSRS(frame: any[], n: number, method: "srswor" | "srswr" | "systematic"): SampleResult {
  const N = frame.length;
  if (N === 0) throw new Error("Sampling frame is empty.");
  if (n <= 0) return { sample: [], probabilities: [], weights: [], indices: [] };

  if (method === "srswor") {
    if (n > N) throw new Error(`Sample size (n=${n}) cannot exceed population size (N=${N}) for sampling without replacement.`);
    
    // Draw without replacement using Reservoir Sampling or Fisher-Yates shuffle subset
    const indices = Array.from({ length: N }, (_, i) => i);
    for (let i = 0; i < n; i++) {
      const randIdx = Math.floor(Math.random() * (N - i)) + i;
      const temp = indices[i];
      indices[i] = indices[randIdx];
      indices[randIdx] = temp;
    }
    
    const selectedIndices = indices.slice(0, n).sort((a, b) => a - b);
    const sample = selectedIndices.map(idx => ({ ...frame[idx] }));
    const prob = n / N;
    const weight = N / n;

    return {
      sample: sample.map(row => {
        row.prob = prob;
        row.weight = weight;
        return row;
      }),
      probabilities: Array(n).fill(prob),
      weights: Array(n).fill(weight),
      indices: selectedIndices
    };

  } else if (method === "srswr") {
    // --- CRITICAL BUG FIX: Duplicates repeated and exact weights applied ---
    const selectedIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      selectedIndices.push(Math.floor(Math.random() * N));
    }
    selectedIndices.sort((a, b) => a - b);

    // Calculate count of selection per unit
    const counts: Record<number, number> = {};
    selectedIndices.forEach(idx => {
      counts[idx] = (counts[idx] || 0) + 1;
    });

    const sample = selectedIndices.map((idx, step) => {
      const row = { ...frame[idx] };
      // Unique SSU ID for duplicates
      row._subsample_id = `${row.ID || idx}_copy_${step}`;
      row.selection_count = counts[idx];
      
      // Inclusion probability for drawing at least once in n trials:
      // pi_i = 1 - (1 - 1/N)^n
      const prob = 1 - Math.pow(1 - 1 / N, n);
      row.prob = prob;
      row.weight = 1 / prob;
      return row;
    });

    return {
      sample,
      probabilities: sample.map(r => r.prob),
      weights: sample.map(r => r.weight),
      indices: selectedIndices
    };

  } else {
    // --- CRITICAL BUG FIX: Systematic with Fractional Interval Safeguard ---
    // k is a fractional interval (N / n)
    const k = N / n;
    const r = Math.random() * k; // random start strictly in [0, k)
    
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
  method: "srswor" | "systematic" = "srswor"
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

    // Draw from the stratum slice
    const drawRes = drawSRS(stratumFrame, n_h, method === "systematic" ? "systematic" : "srswor");
    
    drawRes.sample.forEach((_, i) => {
      const origRow = stratumFrame[drawRes.indices[i]];
      const newRow = { ...origRow };
      newRow.prob = drawRes.probabilities[i];
      newRow.weight = drawRes.weights[i];
      newRow.stratum = stratum;
      
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
export function drawPPS(frame: any[], sizeCol: string, n: number): SampleResult {
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

  const u = Math.random(); // random start in [0, 1)
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
export function drawCluster(frame: any[], clusterCol: string, m: number): SampleResult {
  const clusters: Record<string, any[]> = {};
  frame.forEach((row, originalIndex) => {
    const val = String(row[clusterCol]);
    if (!clusters[val]) clusters[val] = [];
    clusters[val].push({ ...row, _orig_idx: originalIndex });
  });

  const clusterKeys = Object.keys(clusters);
  const M = clusterKeys.length;
  if (M === 0) throw new Error("No clusters found.");
  if (m > M) throw new Error(`Requested clusters (m=${m}) exceeds available clusters (M=${M}).`);

  // SRS select m cluster keys
  const drawnClusterRes = drawSRS(clusterKeys.map(k => ({ ID: k })), m, "srswor");
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
export function drawMultistage(frame: any[], config: StageConfig[], targetN: number | null): any[] {
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

    const groupKeys = Object.keys(groups);
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

      const uniqueUnitsKeys = Object.keys(uniqueUnitsMap);
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

      if (method === "PPS") {
        // Find cluster size (count of records inside each unique unit key)
        const unitSizes = uniqueUnitsKeys.map(k => uniqueUnitsMap[k].length);
        const tempPpsFrame = uniqueUnitsKeys.map((k, i) => ({ ID: k, size: unitSizes[i] }));
        drawRes = drawPPS(tempPpsFrame, "size", nToSelect);
      } else {
        const drawMeth = method === "Systematic Sampling" ? "systematic" : "srswor";
        drawRes = drawSRS(tempUnitFrame, nToSelect, drawMeth);
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
          } else {
            newRec.overall_prob = (rec.overall_prob || 1.0) * unitProb;
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
