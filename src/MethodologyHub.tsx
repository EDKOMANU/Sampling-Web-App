import { useState, useEffect } from 'react';
import {
  GraduationCap,
  Layers,
  Scale,
  ChevronRight,
  Check,
  Award,
  Play,
  RotateCcw,
  ArrowRight,
  Compass,
  Database
} from 'lucide-react';

interface MethodologyHubProps {
  setActiveTab: (tab: 'dashboard' | 'methodology-hub' | 'samplesize' | 'sampling' | 'weighting' | 'variance' | 'subscription') => void;
}

export default function MethodologyHub({ setActiveTab }: MethodologyHubProps) {
  const [hubTab, setHubTab] = useState<'timeline' | 'formulas' | 'grid' | 'deff' | 'raking' | 'quiz'>('timeline');

  // Slide/Timeline Accordion state
  const [activeStep, setActiveStep] = useState<number>(0);

  // Formula Sandbox States
  const [formulaType, setFormulaType] = useState<'cochran_prop' | 'cochran_mean' | 'slovin'>('cochran_prop');
  const [fsN, setFsN] = useState<number>(10000);
  const [fsP, setFsP] = useState<number>(0.5);
  const [fsE, setFsE] = useState<number>(0.05);
  const [fsZ, setFsZ] = useState<number>(1.96); // confidence level proxy
  const [fsSD, setFsSD] = useState<number>(15);

  // Grid Visualizer States
  interface GridCell {
    id: number;
    row: number;
    col: number;
    stratum: string;
    cluster: number;
    selected: boolean;
    pulse: boolean;
  }
  const [grid, setGrid] = useState<GridCell[]>([]);
  const [selectedGridMethod, setSelectedGridMethod] = useState<'srs' | 'systematic' | 'stratified' | 'cluster'>('srs');
  const [isGridDrawing, setIsGridDrawing] = useState<boolean>(false);
  const [gridSpeed, setGridSpeed] = useState<number>(150); // ms delay

  // Deff Sandbox States
  const [deffM, setDeffM] = useState<number>(30); // average cluster size
  const [deffRho, setDeffRho] = useState<number>(0.05); // ICC
  const [deffSampleN, setDeffSampleN] = useState<number>(1000);

  const [uweSpread, setUweSpread] = useState<number>(2.0); // disparity in weights
  const [uweRatio, setUweRatio] = useState<number>(0.3); // ratio of subgroup having high weight

  // Raking IPF Sandbox States
  const [rakeCells, setRakeCells] = useState({
    maleUrban: 30,
    maleRural: 10,
    femaleUrban: 20,
    femaleRural: 40
  });
  const [rakeTargets, setRakeTargets] = useState({
    male: 50,
    female: 50,
    urban: 60,
    rural: 40
  });
  const [rakeStep, setRakeStep] = useState<number>(0);
  const [rakeLogs, setRakeLogs] = useState<string[]>([
    "Initial sample loaded. Weighted margins do not match census targets."
  ]);

  // Quiz States
  const [quizStep, setQuizStep] = useState<number>(0);
  const [answers, setAnswers] = useState<number[]>([-1, -1, -1, -1]);
  const [showQuizResult, setShowQuizResult] = useState<boolean>(false);

  // Initialize Animated Grid
  useEffect(() => {
    initializeGrid();
  }, []);

  const initializeGrid = () => {
    const newGrid: GridCell[] = [];
    for (let i = 0; i < 100; i++) {
      const row = Math.floor(i / 10);
      const col = i % 10;
      
      // Strata: 4 quadrants
      let stratum = 'North';
      if (row < 5 && col < 5) stratum = 'North';
      else if (row < 5 && col >= 5) stratum = 'East';
      else if (row >= 5 && col < 5) stratum = 'South';
      else stratum = 'West';
      
      // Cluster: vertical blocks of columns
      const cluster = Math.floor(col / 2); // 5 clusters total

      newGrid.push({
        id: i,
        row,
        col,
        stratum,
        cluster,
        selected: false,
        pulse: false
      });
    }
    setGrid(newGrid);
  };

  const handleAnimateGridDraw = () => {
    if (isGridDrawing) return;
    setIsGridDrawing(true);
    initializeGrid();

    // Clear selections first
    setGrid(prev => prev.map(c => ({ ...c, selected: false, pulse: false })));

    let indicesToSelect: number[] = [];

    if (selectedGridMethod === 'srs') {
      // 16 random selections
      const pool = Array.from({ length: 100 }, (_, i) => i);
      for (let i = 0; i < 16; i++) {
        const rand = Math.floor(Math.random() * pool.length);
        indicesToSelect.push(pool.splice(rand, 1)[0]);
      }
    } else if (selectedGridMethod === 'systematic') {
      // k = 6, random start in 0..5
      const k = 6;
      const r = Math.floor(Math.random() * k);
      for (let i = 0; i < 16; i++) {
        indicesToSelect.push((r + i * k) % 100);
      }
    } else if (selectedGridMethod === 'stratified') {
      // 4 quadrants. Draw 4 from each
      const poolNorth = Array.from({ length: 100 }, (_, i) => i).filter(i => {
        const r = Math.floor(i / 10), c = i % 10;
        return r < 5 && c < 5;
      });
      const poolEast = Array.from({ length: 100 }, (_, i) => i).filter(i => {
        const r = Math.floor(i / 10), c = i % 10;
        return r < 5 && c >= 5;
      });
      const poolSouth = Array.from({ length: 100 }, (_, i) => i).filter(i => {
        const r = Math.floor(i / 10), c = i % 10;
        return r >= 5 && c < 5;
      });
      const poolWest = Array.from({ length: 100 }, (_, i) => i).filter(i => {
        const r = Math.floor(i / 10), c = i % 10;
        return r >= 5 && c >= 5;
      });

      for (let i = 0; i < 4; i++) {
        indicesToSelect.push(poolNorth.splice(Math.floor(Math.random() * poolNorth.length), 1)[0]);
        indicesToSelect.push(poolEast.splice(Math.floor(Math.random() * poolEast.length), 1)[0]);
        indicesToSelect.push(poolSouth.splice(Math.floor(Math.random() * poolSouth.length), 1)[0]);
        indicesToSelect.push(poolWest.splice(Math.floor(Math.random() * poolWest.length), 1)[0]);
      }
    } else if (selectedGridMethod === 'cluster') {
      // Select 2 clusters out of 0..4
      const c1 = Math.floor(Math.random() * 5);
      let c2 = Math.floor(Math.random() * 5);
      while (c2 === c1) c2 = Math.floor(Math.random() * 5);

      // Select all 20 units in each selected cluster
      for (let i = 0; i < 100; i++) {
        const col = i % 10;
        const cNum = Math.floor(col / 2);
        if (cNum === c1 || cNum === c2) {
          indicesToSelect.push(i);
        }
      }
      // Shuffle indicesToSelect so they animate nicely in blocks
      indicesToSelect.sort((a, b) => (a % 10 === b % 10) ? a - b : (a % 10) - (b % 10));
    }

    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex >= indicesToSelect.length) {
        clearInterval(interval);
        setIsGridDrawing(false);
        return;
      }
      
      const targetId = indicesToSelect[currentIndex];
      setGrid(prev => prev.map(c => {
        if (c.id === targetId) {
          return { ...c, selected: true, pulse: true };
        }
        return { ...c, pulse: false };
      }));

      currentIndex++;
    }, gridSpeed);
  };

  // --- Cochran Math Helper calculations ---
  const calculateFsCochranProp = (N: number | null, p: number, e: number, z: number): { n0: number; n: number } => {
    const n0 = (Math.pow(z, 2) * p * (1 - p)) / Math.pow(e, 2);
    if (N !== null && N > 0) {
      const n = n0 / (1 + ((n0 - 1) / N));
      return { n0: Math.round(n0 * 100) / 100, n: Math.ceil(n) };
    }
    return { n0: Math.round(n0 * 100) / 100, n: Math.ceil(n0) };
  };

  const calculateFsCochranMean = (N: number | null, sd: number, e: number, z: number): { n0: number; n: number } => {
    const n0 = (Math.pow(z, 2) * Math.pow(sd, 2)) / Math.pow(e, 2);
    if (N !== null && N > 0) {
      const n = n0 / (1 + (n0 / N));
      return { n0: Math.round(n0 * 100) / 100, n: Math.ceil(n) };
    }
    return { n0: Math.round(n0 * 100) / 100, n: Math.ceil(n0) };
  };

  const calculateFsSlovin = (N: number, e: number): number => {
    return Math.ceil(N / (1 + N * Math.pow(e, 2)));
  };

  // --- Design Effect Calculations ---
  const kishClusterDeff = 1 + (deffM - 1) * deffRho;
  const effectiveDeffSize = Math.round(deffSampleN / kishClusterDeff);

  // Unequal Weighting Effect Kish approximation: 1 + CV(w)^2
  // Let subgroup ratio be R, multiplier be M.
  // Average weight = R * M + (1-R) * 1.0
  // Mean Sq weight = R * M^2 + (1-R) * 1.0
  // CV = SD / Mean. Deff_weight = n * sum(w^2) / (sum(w))^2 = mean(w^2) / (mean(w))^2
  const meanW = uweRatio * uweSpread + (1 - uweRatio) * 1.0;
  const meanSqW = uweRatio * Math.pow(uweSpread, 2) + (1 - uweRatio) * 1.0;
  const uweDeff = meanW > 0 ? meanSqW / Math.pow(meanW, 2) : 1.0;

  // --- Raking IPF sandbox execution ---
  const handleRakeStep = () => {
    const nextStepNum = rakeStep + 1;
    setRakeStep(nextStepNum);

    const { male, female, urban, rural } = rakeTargets;
    const { maleUrban, maleRural, femaleUrban, femaleRural } = rakeCells;

    if (rakeStep % 2 === 0) {
      // 1. Gender Calibration Step
      const currentMaleSum = maleUrban + maleRural;
      const currentFemaleSum = femaleUrban + femaleRural;

      const factorM = male / currentMaleSum;
      const factorF = female / currentFemaleSum;

      const newMU = maleUrban * factorM;
      const newMR = maleRural * factorM;
      const newFU = femaleUrban * factorF;
      const newFR = femaleRural * factorF;

      setRakeCells({
        maleUrban: newMU,
        maleRural: newMR,
        femaleUrban: newFU,
        femaleRural: newFR
      });

      setRakeLogs(prev => [
        ...prev,
        `[Step ${nextStepNum}: Gender Calibration] Current Male sum was ${currentMaleSum.toFixed(1)} (Target: ${male}). Multiplied Male weights by factor of ${factorM.toFixed(3)}. Female sum was ${currentFemaleSum.toFixed(1)} (Target: ${female}). Multiplied Female weights by factor of ${factorF.toFixed(3)}.`
      ]);
    } else {
      // 2. Region Calibration Step
      const currentUrbanSum = maleUrban + femaleUrban;
      const currentRuralSum = maleRural + femaleRural;

      const factorU = urban / currentUrbanSum;
      const factorR = rural / currentRuralSum;

      const newMU = maleUrban * factorU;
      const newMR = maleRural * factorR;
      const newFU = femaleUrban * factorU;
      const newFR = femaleRural * factorR;

      setRakeCells({
        maleUrban: newMU,
        maleRural: newMR,
        femaleUrban: newFU,
        femaleRural: newFR
      });

      setRakeLogs(prev => [
        ...prev,
        `[Step ${nextStepNum}: Region Calibration] Current Urban sum was ${currentUrbanSum.toFixed(1)} (Target: ${urban}). Multiplied Urban weights by factor of ${factorU.toFixed(3)}. Rural sum was ${currentRuralSum.toFixed(1)} (Target: ${rural}). Multiplied Rural weights by factor of ${factorR.toFixed(3)}.`
      ]);
    }
  };

  const handleResetRaking = () => {
    setRakeCells({
      maleUrban: 30,
      maleRural: 10,
      femaleUrban: 20,
      femaleRural: 40
    });
    setRakeStep(0);
    setRakeLogs(["Initial sample loaded. Weighted margins do not match census targets."]);
  };

  // Calculate current discrepancy percentages
  const currentMaleSum = rakeCells.maleUrban + rakeCells.maleRural;
  const currentFemaleSum = rakeCells.femaleUrban + rakeCells.femaleRural;
  const currentUrbanSum = rakeCells.maleUrban + rakeCells.femaleUrban;
  const currentRuralSum = rakeCells.maleRural + rakeCells.femaleRural;

  const diffMale = Math.abs(currentMaleSum - rakeTargets.male) / rakeTargets.male;
  const diffFemale = Math.abs(currentFemaleSum - rakeTargets.female) / rakeTargets.female;
  const diffUrban = Math.abs(currentUrbanSum - rakeTargets.urban) / rakeTargets.urban;
  const diffRural = Math.abs(currentRuralSum - rakeTargets.rural) / rakeTargets.rural;
  const maxDiscrepancyPct = Math.max(diffMale, diffFemale, diffUrban, diffRural) * 100;

  // --- Quiz questions config ---
  const quizQuestions = [
    {
      q: "What is the structural nature of your population sampling frame?",
      options: [
        "A flat database list of all population individuals or entities (e.g. population registry).",
        "A list categorized into clear sub-segments (e.g. regions, industry categories, gender bands).",
        "No individual list exists, only grouped locations or cluster nodes (e.g. schools, clinics, villages)."
      ]
    },
    {
      q: "Do you have access to auxiliary demographic totals for the target population (e.g. from census registry)?",
      options: [
        "No, I only have access to the survey sample database.",
        "Yes, I have known population totals/margins for age groups, gender segments, regions, etc."
      ]
    },
    {
      q: "Do you expect systematic non-response in certain demographics (e.g. younger people less likely to answer)?",
      options: [
        "Yes, certain subgroups are systematically harder to contact or recruit.",
        "No, I expect response rates to be roughly uniform across the entire sample."
      ]
    },
    {
      q: "What is your primary analytical goal and target estimator?",
      options: [
        "Simple point estimates (means/totals) with standard linearization errors.",
        "Mathematically complex estimators (regression ratios, Gini coefficients) requiring resampling standard errors."
      ]
    }
  ];

  const handleQuizAnswer = (optIdx: number) => {
    const updated = [...answers];
    updated[quizStep] = optIdx;
    setAnswers(updated);

    if (quizStep < quizQuestions.length - 1) {
      setQuizStep(quizStep + 1);
    } else {
      setShowQuizResult(true);
    }
  };

  const handleResetQuiz = () => {
    setQuizStep(0);
    setAnswers([-1, -1, -1, -1]);
    setShowQuizResult(false);
  };

  // Get diagnostic blueprint recommendations
  const getDiagnosticBlueprint = () => {
    const [q1, q2, q3, q4] = answers;
    let sampling = "Simple Random Sampling (SRS)";
    let weighting = "Direct Inverse Probability Weights (d_i = N / n)";
    let variance = "Taylor Series Linearization";
    let linkTab: 'samplesize' | 'sampling' | 'weighting' | 'variance' = 'sampling';
    let summaryText = "";

    // 1. Determine sampling
    if (q1 === 1) {
      sampling = "Stratified Systematic Sampling";
      summaryText += "Your frame's subgroup structure allows you to use Stratification to guarantee zero selection bias and higher precision. ";
      linkTab = 'samplesize';
    } else if (q1 === 2) {
      sampling = "Single-Stage Cluster Sampling or Multistage Selection";
      summaryText += "Since you lack a flat list and must sample grouped entities, Cluster sampling is optimal. Be sure to account for Design Effects (Deff) inflation! ";
      linkTab = 'sampling';
    } else {
      sampling = "Simple Random Sampling (SRS) or Systematic Draw";
      summaryText += "A flat, homogeneous list is perfectly suited for SRS or Fractional Systematic drawing. ";
      linkTab = 'sampling';
    }

    // 2. Determine weighting
    if (q2 === 1 && q3 === 0) {
      weighting = "Base Weights + Propensity Adjustments + Calibration Raking (IPF)";
      summaryText += "Because you have auxiliary census totals and systematic non-response, we highly recommend fitting a response propensity model to adjust base weights, followed by Iterative Proportional Fitting (raking) to match your targets exactly.";
    } else if (q2 === 1) {
      weighting = "Base Weights + Calibration Raking (IPF) to Population Margins";
      summaryText += "Census marginals allow you to rake your base weights, removing coverage bias and matching known population aggregates.";
    } else if (q3 === 0) {
      weighting = "Base Weights + Weighting Class Non-Response Inflation";
      summaryText += "To fix non-response, use Weighting Classes (e.g. Region or Age) to inflate respondent weights by the inverse response rate of each class.";
    } else {
      weighting = "Inverse Inclusion Probability Weights (d_i = 1 / pi_i)";
      summaryText += "With uniform response and no population marginals, basic inverse-probability design weights are robust and self-correcting.";
    }

    // 3. Determine variance
    if (q4 === 1) {
      variance = "McCarthy-Snowden / Rao-Wu Stratified Bootstrap Resampling";
      summaryText += " Resampling bootstrap weights (e.g. 100 replicates) are ideal for complex multivariate indicators and capture calibration variance reductions perfectly.";
    } else {
      variance = "Stratified Taylor Series Linearization (Infinitesimal Jackknife)";
      summaryText += " Standard linearized standard errors are highly efficient for means and totals, matching standard R/SAS outputs.";
    }

    return { sampling, weighting, variance, linkTab, summaryText };
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner and Navigation */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="text-left">
          <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold font-mono tracking-wider uppercase">
            Official Statistics Knowledge Laboratory
          </span>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2.5 mt-2">
            <GraduationCap className="h-7 w-7 text-indigo-400" />
            Interactive Methodology & Knowledge Hub
          </h2>
          <p className="text-xs text-gray-400 mt-1">Master survey design, sample sizes, design effects, and calibration mechanics completely offline</p>
        </div>

        {/* Local Tab Selector */}
        <div className="flex flex-wrap items-center gap-1 bg-gray-950/60 border border-white/10 p-1 rounded-xl glass-panel text-xs">
          <button
            onClick={() => setHubTab('timeline')}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium ${hubTab === 'timeline' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Lifecycle Timeline
          </button>
          <button
            onClick={() => setHubTab('formulas')}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium ${hubTab === 'formulas' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Formula Sandbox
          </button>
          <button
            onClick={() => setHubTab('grid')}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium ${hubTab === 'grid' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Sampling Grid
          </button>
          <button
            onClick={() => setHubTab('deff')}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium ${hubTab === 'deff' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Design Effects
          </button>
          <button
            onClick={() => setHubTab('raking')}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium ${hubTab === 'raking' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Calibration Sandbox
          </button>
          <button
            onClick={() => setHubTab('quiz')}
            className={`px-3 py-1.5 rounded-lg transition-all font-medium ${hubTab === 'quiz' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            Methodology Quiz
          </button>
        </div>
      </div>

      <div className="w-full">
        
        {/* SUB-TAB 1: STATISTICAL LIFECYCLE TIMELINE */}
        {hubTab === 'timeline' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
            
            {/* Timeline sidebar items */}
            <div className="lg:col-span-1 space-y-3">
              <div className="glass-panel p-4 rounded-xl border border-white/5">
                <span className="text-[10px] text-gray-500 font-mono tracking-wider uppercase font-semibold">interactive methodology roadmap</span>
                <h3 className="text-sm font-bold text-white mt-1">The 6 Steps of Survey Weights & Analysis</h3>
                <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                  In official statistics, pulling standard errors requires careful mathematical adjustments. Click on any step to explore its underlying formulas, caveats, and where to apply it!
                </p>
              </div>

              <div className="space-y-2">
                {[
                  { title: "1. Sampling Frame Definition", desc: "Target populations & lists" },
                  { title: "2. Sample Size & Allocation", desc: "Cochran formulas & strata quotas" },
                  { title: "3. Representative Sample Draw", desc: "SRS, Systematic, Cluster draws" },
                  { title: "4. Non-Response Weight Adjustments", desc: "Weight class inflation & propensity models" },
                  { title: "5. Calibration Suite (IPF, GREG, Logit)", desc: "Aligning sample weights to known demographics" },
                  { title: "6. Variance & Design-based SEs", desc: "Taylor series linearization vs bootstrap" }
                ].map((step, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveStep(idx)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                      activeStep === idx
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-white glow-primary'
                        : 'bg-white/5 border-white/5 text-gray-300 hover:bg-white/10 hover:border-white/10'
                    }`}
                  >
                    <div>
                      <h4 className="text-xs font-bold font-mono tracking-wide">{step.title}</h4>
                      <p className="text-[10px] text-gray-400 mt-0.5">{step.desc}</p>
                    </div>
                    <ChevronRight className={`h-4 w-4 text-gray-400 transition-all ${activeStep === idx ? 'transform translate-x-1 text-indigo-400' : ''}`} />
                  </button>
                ))}
              </div>
            </div>

            {/* Step expansion Details Panel */}
            <div className="lg:col-span-2 glass-panel border border-white/5 rounded-2xl p-6 flex flex-col justify-between min-h-[500px]">
              <div className="space-y-6">
                
                {/* Active Step Header */}
                <div className="border-b border-white/10 pb-4 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
                      STEP 0{activeStep + 1} OF 06
                    </span>
                    <h3 className="text-xl font-extrabold text-white mt-2">
                      {[
                        "Sampling Frame Definition",
                        "Sample Size Calculation & Stratum Allocation",
                        "Representative Selection Draw",
                        "Non-Response Weight Adjustments",
                        "Calibration Suite (Multiplicative, Linear & Bounded Logit)",
                        "Variance Estimation & Design-Based Analytics"
                      ][activeStep]}
                    </h3>
                  </div>
                  <div className="h-10 w-10 bg-indigo-500/10 rounded-xl flex items-center justify-center border border-indigo-500/20">
                    <Database className="h-5 w-5 text-indigo-400" />
                  </div>
                </div>

                {/* Step descriptions */}
                {activeStep === 0 && (
                  <div className="space-y-4 text-xs text-gray-300 leading-relaxed">
                    <p>
                      The **Sampling Frame** is the formal registry, census database, or listing containing all elements of the target population $N$ from which the sample is drawn. A poor frame leads to **Coverage Bias** (omitting segments of interest) which ruins statistical representation.
                    </p>
                    <div className="bg-white/5 border border-white/5 p-4 rounded-xl space-y-2">
                      <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-indigo-300">key design considerations:</h4>
                      <ul className="list-disc pl-4 space-y-1.5 text-[11px]">
                        <li>**FPC (Finite Population Correction)**: When sampling fraction $f = n / N$ exceeds 5%, the statistical variance must be shrunk by factor $(1 - f)$ because the population size is finite.</li>
                        <li>**Undercoverage**: If young voters are missing from landline registries, design weights cannot correct this without auxiliary variables.</li>
                      </ul>
                    </div>
                    <p className="font-semibold text-indigo-300">
                      Mr_Ed' Sampling Suite tip: Load your frame CSV or Excel file directly in the Dashboard or the Sampling Console. Everything runs safely inside local memory!
                    </p>
                  </div>
                )}

                {activeStep === 1 && (
                  <div className="space-y-4 text-xs text-gray-300 leading-relaxed">
                    <p>
                      Before spending budget, we calculate the required sample size $n$ to guarantee a specific margin of error $e$ at a chosen confidence interval (Z-score). For subgroup analysis, we then allocate this total size exactly across strata.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white/5 border border-white/5 p-4 rounded-xl">
                        <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-indigo-300">cochran proportions formula</h4>
                        <p className="font-mono mt-2 text-[11px] text-emerald-400 text-center">n0 = (Z² * p * (1-p)) / e²</p>
                        <p className="text-[10px] text-gray-400 mt-2">Maximum conservative sample size occurs at expected proportion p = 0.5.</p>
                      </div>
                      <div className="bg-white/5 border border-white/5 p-4 rounded-xl">
                        <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-indigo-300 font-semibold">neyman optimal allocation</h4>
                        <p className="font-mono mt-2 text-[11px] text-emerald-400 text-center">n_h = n * (N_h * S_h) / Σ(N_h * S_h)</p>
                        <p className="text-[10px] text-gray-400 mt-2">Neyman optimal allocation draws larger samples from strata with higher internal standard deviation (variance), maximizing overall precision.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setHubTab('formulas')}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Open Interactive Sliders Sandbox <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {activeStep === 2 && (
                  <div className="space-y-4 text-xs text-gray-300 leading-relaxed">
                    <p>
                      Sampling must be executed randomly under exact inclusion probabilities $\pi_i$. The **Base Weight** (design weight) of unit $i$ is defined as the inverse of its inclusion probability:
                    </p>
                    <p className="font-mono text-center text-sm text-emerald-400">d_i = 1 / pi_i</p>
                    <p>
                      A unit with a 2% chance of selection represents 50 similar individuals in the population. Mr_Ed' Sampling Suite guarantees absolute mathematical drawing compliance for:
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-[11px] bg-white/5 border border-white/5 p-3 rounded-xl">
                      <div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-indigo-400" /> SRSwor (Without replacement)</div>
                      <div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-indigo-400" /> Fractional Systematic drawing</div>
                      <div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-indigo-400" /> Stratified draws per stratum</div>
                      <div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-indigo-400" /> Systematic PPS (Size measures)</div>
                    </div>
                  </div>
                )}

                {activeStep === 3 && (
                  <div className="space-y-4 text-xs text-gray-300 leading-relaxed">
                    <p>
                      In real-world surveys, non-response is inevitable. If non-response is correlated with target outcomes (e.g. low-income males are harder to reach), our estimates become biased. We must adjust the base weights of respondents to represent non-respondents.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white/5 border border-white/5 p-4 rounded-xl">
                        <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-indigo-300">weighting class adjustment</h4>
                        <p className="text-[11px] mt-1 text-gray-300">Inflates weights inside distinct categories: factor = Σ(Eligible Weights) / Σ(Respondent Weights).</p>
                      </div>
                      <div className="bg-white/5 border border-white/5 p-4 rounded-xl">
                        <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-pink-300">response propensity modeling</h4>
                        <p className="text-[11px] mt-1 text-gray-300">Fits a logistic regression $P(R=1 | X)$ in local RAM to calculate respondent adjustment factors directly: factor = $1 / P(R=1 | X)$.</p>
                      </div>
                    </div>
                  </div>
                )}

                {activeStep === 4 && (
                  <div className="space-y-4 text-xs text-gray-300 leading-relaxed">
                    <p>
                      **Calibration** adjusts survey weights so that the sample's weighted distribution aligns perfectly with external population control totals (e.g., census proportions). This step resolves coverage gaps and non-response bias.
                    </p>
                    <p>
                      Mr_Ed' Sampling Suite supports **Dual Data Sourcing**: you can calibrate weights either using actively drawn sample data or uploaded external fieldwork survey files. These are adjusted against the original census frame or custom uploaded demographic target registries.
                    </p>

                    <div className="space-y-3 bg-white/5 border border-white/5 p-4 rounded-xl">
                      <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-indigo-300">Three Advanced Calibration Solvers:</h4>
                      
                      <div className="space-y-2 text-[11px]">
                        <p>
                          1. **Multiplicative Raking (IPF)**: Iteratively multiplies base weights margin-by-margin. It is multiplicative, meaning weights scale exponentially and are mathematically guaranteed to remain strictly positive ({"$w_i > 0$"}).
                        </p>
                        <p>
                          2. **Linear Calibration (GREG Solver)**: A single-step analytical solver using Lagrange multipliers, matching Generalized Regression (GREG) estimation equations. Weights are computed as:
                          {"$$w_i = d_i (1 + \\mathbf{x}_i^T \\boldsymbol{\\lambda})$$"}
                          {"where \\(\\boldsymbol{\\lambda} = \\left(\\sum_i d_i \\mathbf{x}_i \\mathbf{x}_i^T\\right)^{-1} (\\mathbf{T} - \\sum_i d_i \\mathbf{x}_i)\\). Highly efficient, though weights can occasionally be negative."}
                        </p>
                        <p>
                          3. **Logit Calibration (Bounded Ratio)**: Bounded Iterative Proportional Fitting that restricts weight multipliers strictly within user-defined upper ({"$U$"}) and lower ({"$L$"}) bounds. This prevents extreme multipliers and controls design variance inflation.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3 bg-white/5 border border-white/5 p-4 rounded-xl">
                      <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-pink-300">Demographics Audit & Representativeness Dashboard:</h4>
                      <div className="space-y-2 text-[11px]">
                        <p>
                          - **Dissimilarity Index ({"$D$"})**: Measures the representation gap.
                          {"$$D = 0.5 \\sum_{j} |p_j - t_j|$$"}
                          {"where \\(p_j\\) is the weighted category proportion and \\(t_j\\) is the target census proportion. A dissimilarity index of 0% denotes perfect population representativeness."}
                        </p>
                        <p>
                          - **Bias Correction Score**: Quantifies the percentage of representational bias resolved.
                          {"$$\\text{Bias Corrected \\%} = \\frac{D_{\\text{before}} - D_{\\text{after}}}{D_{\\text{before}}} \\times 100$$"}
                        </p>
                        <p>
                          - **Excel Audits**: Allows exporting beautiful, print-ready reports ({"`Weighted_Demographics_Audit_Report.xlsx`"}) for stakeholders.
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setHubTab('raking')}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Open Interactive Raking Simulator <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {activeStep === 5 && (
                  <div className="space-y-4 text-xs text-gray-300 leading-relaxed">
                    <p>
                      Standard standard error formulas assume Simple Random Sampling. Under complex designs (with clustering, stratification, and calibration), standard errors must be computed using design-based methods to prevent underestimating variance.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white/5 border border-white/5 p-4 rounded-xl">
                        <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-indigo-300">taylor series linearization</h4>
                        <p className="text-[11px] mt-1 text-gray-300">Linearizes non-linear estimators (e.g. ratio means) to compute exact stratified design-based variances: V = sum_h [ (n_h / (n_h - 1)) * sum_i (z_hi - z_bar_h)^2 ].</p>
                      </div>
                      <div className="bg-white/5 border border-white/5 p-4 rounded-xl">
                        <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-pink-300 font-semibold">rao-wu cluster bootstrap</h4>
                        <p className="text-[11px] mt-1 text-gray-300">Resamples clusters with replacement in each stratum to build B replicate weight columns. If raking is re-applied, this captures the variance-reducing properties of calibration perfectly!</p>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Lifecycle action buttons */}
              <div className="border-t border-white/10 pt-4 flex justify-between items-center bg-gray-950/20 px-2 rounded-xl mt-6">
                <span className="text-[11px] text-gray-500 font-semibold font-mono">Mr_Ed' Sampling Suite Workflow Integration</span>
                <button
                  onClick={() => {
                    const tabMap: Record<number, 'samplesize' | 'sampling' | 'weighting' | 'variance'> = {
                      0: 'sampling',
                      1: 'samplesize',
                      2: 'sampling',
                      3: 'weighting',
                      4: 'weighting',
                      5: 'variance'
                    };
                    setActiveTab(tabMap[activeStep]);
                  }}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs hover-lift transition-all flex items-center gap-1.5"
                >
                  <Compass className="h-3.5 w-3.5 animate-spin delay-1000" />
                  Jump to Core Module
                </button>
              </div>

            </div>
          </div>
        )}

        {/* SUB-TAB 2: INTERACTIVE FORMULA SANDBOX */}
        {hubTab === 'formulas' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
            
            {/* Sliders and Controls */}
            <div className="lg:col-span-1 glass-panel border border-white/5 p-6 rounded-2xl space-y-5">
              <div className="border-b border-white/10 pb-2">
                <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Formula Selector</h3>
              </div>

              <div className="space-y-1">
                <button
                  onClick={() => setFormulaType('cochran_prop')}
                  className={`w-full text-left p-3 rounded-lg border text-xs font-semibold transition-all ${formulaType === 'cochran_prop' ? 'bg-indigo-600 border-indigo-500 text-white font-bold' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 text-gray-200'}`}
                >
                  Cochran Proportions Formula
                </button>
                <button
                  onClick={() => setFormulaType('cochran_mean')}
                  className={`w-full text-left p-3 rounded-lg border text-xs font-semibold transition-all ${formulaType === 'cochran_mean' ? 'bg-indigo-600 border-indigo-500 text-white font-bold' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 text-gray-200'}`}
                >
                  Cochran Continuous Mean Formula
                </button>
                <button
                  onClick={() => setFormulaType('slovin')}
                  className={`w-full text-left p-3 rounded-lg border text-xs font-semibold transition-all ${formulaType === 'slovin' ? 'bg-indigo-600 border-indigo-500 text-white font-bold' : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 text-gray-200'}`}
                >
                  Slovin / Yamane Formula
                </button>
              </div>

              <div className="border-t border-white/10 pt-4 space-y-4">
                <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider text-[10px] text-indigo-300">Parameters</h4>

                {/* Population Size */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-400">Population Size (N)</span>
                    <span className="text-white font-mono">{fsN.toLocaleString()}</span>
                  </div>
                  <input
                    type="range"
                    min={100}
                    max={100000}
                    step={100}
                    value={fsN}
                    onChange={(e) => setFsN(parseInt(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                {/* Margin of Error */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-400">Margin of Error (e)</span>
                    <span className="text-white font-mono">{(fsE * 100).toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.01}
                    max={0.15}
                    step={0.005}
                    value={fsE}
                    onChange={(e) => setFsE(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                {/* Expected proportion for Cochran proportions */}
                {formulaType === 'cochran_prop' && (
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-gray-400">Expected Proportion (p)</span>
                      <span className="text-white font-mono">{(fsP * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={0.95}
                      step={0.05}
                      value={fsP}
                      onChange={(e) => setFsP(parseFloat(e.target.value))}
                      className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                )}

                {/* Standard Deviation for Cochran mean */}
                {formulaType === 'cochran_mean' && (
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span className="text-gray-400">Stratum SD (S)</span>
                      <span className="text-white font-mono">{fsSD}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      step={1}
                      value={fsSD}
                      onChange={(e) => setFsSD(parseInt(e.target.value))}
                      className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                )}

                {/* Confidence Level Z score selector */}
                {formulaType !== 'slovin' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 mb-1.5">Confidence Level (Z-Score)</label>
                    <select
                      value={fsZ}
                      onChange={(e) => setFsZ(parseFloat(e.target.value))}
                      className="w-full bg-gray-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    >
                      <option value={1.645}>90% Confidence (Z = 1.645)</option>
                      <option value={1.96}>95% Confidence (Z = 1.960)</option>
                      <option value={2.576}>99% Confidence (Z = 2.576)</option>
                    </select>
                  </div>
                )}

              </div>
            </div>

            {/* Math Solver Output Panel */}
            <div className="lg:col-span-2 glass-panel border border-white/5 rounded-2xl p-6 flex flex-col justify-between min-h-[500px]">
              <div className="space-y-6">
                
                <div className="border-b border-white/10 pb-4">
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                    REAL-TIME SYMBOLIC INTERPRETER
                  </span>
                  <h3 className="text-xl font-extrabold text-white mt-2">Step-by-Step Formula Expansion</h3>
                </div>

                {formulaType === 'cochran_prop' && (() => {
                  const { n0, n } = calculateFsCochranProp(fsN, fsP, fsE, fsZ);
                  return (
                    <div className="space-y-5 text-sm text-gray-300">
                      <div>
                        <p className="text-gray-400 text-xs">Cochran's Proportions Formula represents how large a sample size is required to estimate an outcome share within error bounds $e$:</p>
                        <div className="bg-gray-950/40 p-4 rounded-xl border border-white/5 text-center mt-3">
                          <p className="font-mono text-indigo-400 text-lg">n₀ = (Z² × p × (1-p)) / e²</p>
                          <p className="font-mono text-pink-400 text-lg mt-2">n = n₀ / (1 + (n₀ - 1) / N)</p>
                        </div>
                      </div>

                      <div className="space-y-3 font-mono text-xs bg-white/5 p-5 rounded-xl border border-white/5">
                        <p className="text-indigo-300 font-bold uppercase tracking-wider text-[9px] mb-2 font-sans">Plug-in Calculations:</p>
                        
                        <div>
                          <p className="text-gray-400 font-sans">Step 1: Compute infinite population base (n₀)</p>
                          <p className="text-emerald-400 mt-1">n₀ = ({fsZ}² × {fsP} × (1 - {fsP})) / {fsE}²</p>
                          <p className="text-emerald-400">n₀ = ({(fsZ*fsZ).toFixed(4)} × {fsP} × {(1-fsP).toFixed(2)}) / {(fsE*fsE).toFixed(5)}</p>
                          <p className="text-emerald-400">n₀ = {(fsZ*fsZ * fsP * (1-fsP)).toFixed(4)} / {(fsE*fsE).toFixed(5)} = <span className="font-bold text-white bg-indigo-500/20 px-1 py-0.5 rounded">{n0}</span></p>
                        </div>

                        <div className="border-t border-white/10 pt-3 mt-3">
                          <p className="text-gray-400 font-sans">Step 2: Apply Finite Population Correction (FPC) for N = {fsN.toLocaleString()}</p>
                          <p className="text-emerald-400 mt-1">n = {n0} / (1 + ({n0} - 1) / {fsN})</p>
                          <p className="text-emerald-400">n = {n0} / (1 + {(n0 - 1).toFixed(2)} / {fsN})</p>
                          <p className="text-emerald-400">n = {n0} / (1 + {((n0 - 1)/fsN).toFixed(5)})</p>
                          <p className="text-emerald-400">n = {n0} / {(1 + (n0 - 1)/fsN).toFixed(5)} = {(n0 / (1 + (n0 - 1)/fsN)).toFixed(2)}</p>
                        </div>

                        <div className="border-t border-white/10 pt-3 mt-3">
                          <p className="text-gray-400 font-sans">Step 3: Ceiling to Next Integer</p>
                          <p className="text-indigo-300 font-bold">n = ⌈{(n0 / (1 + (n0 - 1)/fsN)).toFixed(2)}⌉ = {n} units</p>
                        </div>
                      </div>

                      <div className="bg-indigo-600/10 border border-indigo-500/20 p-4 rounded-xl flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-400">Calculated Sample Quota:</p>
                          <h4 className="text-2xl font-black text-white">n = {n.toLocaleString()} units</h4>
                        </div>
                        <button
                          onClick={() => {
                            setActiveTab('samplesize');
                          }}
                          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs hover-lift transition-all"
                        >
                          Execute Size Calculator
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {formulaType === 'cochran_mean' && (() => {
                  const { n0, n } = calculateFsCochranMean(fsN, fsSD, fsE, fsZ);
                  return (
                    <div className="space-y-5 text-sm text-gray-300">
                      <div>
                        <p className="text-gray-400 text-xs">Cochran's Continuous Mean Formula models populations where target indicators are numeric values (such as income, height, or test scores), depending on stratum variance standard deviation $S$:</p>
                        <div className="bg-gray-950/40 p-4 rounded-xl border border-white/5 text-center mt-3">
                          <p className="font-mono text-indigo-400 text-lg">n₀ = (Z² × S²) / e²</p>
                          <p className="font-mono text-pink-400 text-lg mt-2">n = n₀ / (1 + n₀ / N)</p>
                        </div>
                      </div>

                      <div className="space-y-3 font-mono text-xs bg-white/5 p-5 rounded-xl border border-white/5">
                        <p className="text-indigo-300 font-bold uppercase tracking-wider text-[9px] mb-2 font-sans">Plug-in Calculations:</p>
                        
                        <div>
                          <p className="text-gray-400 font-sans">Step 1: Compute base size (n₀)</p>
                          <p className="text-emerald-400 mt-1">n₀ = ({fsZ}² × {fsSD}²) / {fsE}²</p>
                          <p className="text-emerald-400">n₀ = ({(fsZ*fsZ).toFixed(4)} × {fsSD*fsSD}) / {(fsE*fsE).toFixed(5)}</p>
                          <p className="text-emerald-400">n₀ = {(fsZ*fsZ * fsSD * fsSD).toFixed(4)} / {(fsE*fsE).toFixed(5)} = <span className="font-bold text-white bg-indigo-500/20 px-1 py-0.5 rounded">{n0}</span></p>
                        </div>

                        <div className="border-t border-white/10 pt-3 mt-3">
                          <p className="text-gray-400 font-sans">Step 2: Apply Finite Population Correction for N = {fsN.toLocaleString()}</p>
                          <p className="text-emerald-400 mt-1">n = {n0} / (1 + {n0} / {fsN})</p>
                          <p className="text-emerald-400">n = {n0} / (1 + {(n0 / fsN).toFixed(5)})</p>
                          <p className="text-emerald-400">n = {n0} / {(1 + n0 / fsN).toFixed(5)} = {(n0 / (1 + n0 / fsN)).toFixed(2)}</p>
                        </div>

                        <div className="border-t border-white/10 pt-3 mt-3">
                          <p className="text-gray-400 font-sans">Step 3: Ceiling to Next Integer</p>
                          <p className="text-indigo-300 font-bold">n = ⌈{(n0 / (1 + n0 / fsN)).toFixed(2)}⌉ = {n} units</p>
                        </div>
                      </div>

                      <div className="bg-indigo-600/10 border border-indigo-500/20 p-4 rounded-xl flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-400">Calculated Sample Quota:</p>
                          <h4 className="text-2xl font-black text-white">n = {n.toLocaleString()} units</h4>
                        </div>
                        <button
                          onClick={() => setActiveTab('samplesize')}
                          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs hover-lift transition-all"
                        >
                          Execute Size Calculator
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {formulaType === 'slovin' && (() => {
                  const n = calculateFsSlovin(fsN, fsE);
                  return (
                    <div className="space-y-5 text-sm text-gray-300">
                      <div>
                        <p className="text-gray-400 text-xs">Slovin's Formula (Yamane's simplified correction) is a robust shortcut for calculating sample sizes under random conditions where target proportions are completely unknown:</p>
                        <div className="bg-gray-950/40 p-4 rounded-xl border border-white/5 text-center mt-3">
                          <p className="font-mono text-indigo-400 text-lg">n = N / (1 + N × e²)</p>
                        </div>
                      </div>

                      <div className="space-y-3 font-mono text-xs bg-white/5 p-5 rounded-xl border border-white/5">
                        <p className="text-indigo-300 font-bold uppercase tracking-wider text-[9px] mb-2 font-sans">Plug-in Calculations:</p>
                        
                        <div>
                          <p className="text-gray-400 font-sans">Step 1: Plug in Population N and Margin of Error $e$</p>
                          <p className="text-emerald-400 mt-1">n = {fsN} / (1 + {fsN} × {fsE}²)</p>
                          <p className="text-emerald-400">n = {fsN} / (1 + {fsN} × {(fsE*fsE).toFixed(5)})</p>
                          <p className="text-emerald-400">n = {fsN} / (1 + {(fsN * fsE * fsE).toFixed(2)})</p>
                          <p className="text-emerald-400">n = {fsN} / {(1 + fsN * fsE * fsE).toFixed(2)} = {(fsN / (1 + fsN * fsE * fsE)).toFixed(2)}</p>
                        </div>

                        <div className="border-t border-white/10 pt-3 mt-3">
                          <p className="text-gray-400 font-sans">Step 2: Ceiling to Next Integer</p>
                          <p className="text-indigo-300 font-bold font-mono">n = ⌈{(fsN / (1 + fsN * fsE * fsE)).toFixed(2)}⌉ = {n} units</p>
                        </div>
                      </div>

                      <div className="bg-indigo-600/10 border border-indigo-500/20 p-4 rounded-xl flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-400">Calculated Sample Quota:</p>
                          <h4 className="text-2xl font-black text-white">n = {n.toLocaleString()} units</h4>
                        </div>
                        <button
                          onClick={() => setActiveTab('samplesize')}
                          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs hover-lift transition-all"
                        >
                          Execute Size Calculator
                        </button>
                      </div>
                    </div>
                  );
                })()}

              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 3: SAMPLING GRID VISUALIZER */}
        {hubTab === 'grid' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
            
            {/* Visualizer Controls */}
            <div className="lg:col-span-1 glass-panel border border-white/5 p-6 rounded-2xl space-y-4">
              <div className="border-b border-white/10 pb-2">
                <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Methodology Animator</h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                This 100-cell grid represents a census population. Each cell is grouped by **Stratum (4 quadrants)** and **Cluster (5 column bands)**. Play selection draws to see different representation distributions!
              </p>

              <div className="space-y-1">
                {[
                  { id: 'srs', title: "Simple Random Sampling (SRS)", desc: "16 random selections across grid" },
                  { id: 'systematic', title: "Systematic Selection", desc: "Draw every 6th cell, random start" },
                  { id: 'stratified', title: "Stratified Draw (Quadrant)", desc: "4 equal selections per quadrant" },
                  { id: 'cluster', title: "Cluster Drawing (Columns)", desc: "Draw 2 entire column bands" }
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedGridMethod(item.id as any)}
                    className={`w-full text-left p-3 rounded-xl border text-xs font-semibold transition-all ${
                      selectedGridMethod === item.id 
                        ? 'bg-indigo-600 border-indigo-500 text-white font-bold' 
                        : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 text-gray-200'
                    }`}
                  >
                    <h4>{item.title}</h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">{item.desc}</p>
                  </button>
                ))}
              </div>

              <div className="border-t border-white/10 pt-4 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-gray-400 font-semibold">Animation Speed</span>
                  <span className="text-indigo-400 font-bold font-mono">{gridSpeed} ms</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={400}
                  step={50}
                  value={gridSpeed}
                  onChange={(e) => setGridSpeed(parseInt(e.target.value))}
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />

                <button
                  onClick={handleAnimateGridDraw}
                  disabled={isGridDrawing}
                  className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold text-xs hover-lift transition-all flex items-center justify-center gap-2 mt-4"
                >
                  <Play className="h-3.5 w-3.5 fill-white" />
                  {isGridDrawing ? "Drawing in progress..." : "Animate Representative Draw"}
                </button>
              </div>
            </div>

            {/* Grid Display & Legends */}
            <div className="lg:col-span-2 glass-panel border border-white/5 rounded-2xl p-6 flex flex-col md:flex-row gap-6">
              
              {/* Dot Grid */}
              <div className="flex-1 flex flex-col justify-center items-center">
                <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20 mb-4 self-start">
                  10 × 10 POPULATION GRID
                </span>
                
                <div className="grid grid-cols-10 gap-2 bg-slate-950/60 p-4 rounded-2xl border border-white/10 shadow-inner max-w-sm">
                  {grid.map(c => {
                    // Quadrant colors
                    let cellBg = 'bg-gray-800/80';
                    let borderCol = 'border-white/10';
                    
                    if (c.selected) {
                      cellBg = 'bg-gradient-to-tr from-indigo-500 to-pink-500 glow-primary scale-110';
                      borderCol = 'border-white';
                    } else {
                      if (c.stratum === 'North') { borderCol = 'border-red-500/30'; }
                      else if (c.stratum === 'East') { borderCol = 'border-blue-500/30'; }
                      else if (c.stratum === 'South') { borderCol = 'border-emerald-500/30'; }
                      else { borderCol = 'border-amber-500/30'; }
                    }

                    return (
                      <div
                        key={c.id}
                        className={`h-6 w-6 rounded-full border flex items-center justify-center text-[8px] font-mono font-bold transition-all duration-300 ${cellBg} ${borderCol} ${c.pulse ? 'animate-ping' : ''}`}
                        title={`ID: ${c.id}, Stratum: ${c.stratum}, Cluster: ${c.cluster}`}
                      >
                        {c.selected ? '✓' : ''}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Legends and Educational box */}
              <div className="w-full md:w-56 space-y-4 text-xs">
                <div>
                  <h4 className="font-bold text-white">Visual Design Guide</h4>
                  <p className="text-[11px] text-gray-400 mt-1">Quadrants represent stratification variables. Columns represent clustered elements.</p>
                </div>

                <div className="space-y-2 text-[10px] font-mono bg-white/5 p-3 rounded-xl border border-white/5">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full border border-red-500/40 bg-gray-900" />
                    <span className="text-gray-300">Stratum North (Red border)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full border border-blue-500/40 bg-gray-900" />
                    <span className="text-gray-300">Stratum East (Blue border)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full border border-emerald-500/40 bg-gray-900" />
                    <span className="text-gray-300">Stratum South (Green border)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full border border-amber-500/40 bg-gray-900" />
                    <span className="text-gray-300">Stratum West (Yellow border)</span>
                  </div>
                  <div className="flex items-center gap-2 border-t border-white/10 pt-2 mt-2">
                    <div className="h-3 w-3 rounded-full bg-gradient-to-tr from-indigo-500 to-pink-500" />
                    <span className="text-white font-bold">Selected Sample Unit</span>
                  </div>
                </div>

                <div className="bg-white/5 p-4 rounded-xl border border-white/5 text-[11px] text-gray-400 space-y-2 leading-relaxed">
                  <h5 className="font-bold text-indigo-300 font-mono text-[9px] uppercase tracking-wider">statistical trade-offs:</h5>
                  {selectedGridMethod === 'srs' && <p>**SRS** selects elements completely at random, ensuring equal probability, but can lead to random clustering or missing small subgroups completely.</p>}
                  {selectedGridMethod === 'systematic' && <p>**Systematic Draw** guarantees even spread across the population frame list, but can be highly biased if the frame has periodic pattern cycles matching interval $k$.</p>}
                  {selectedGridMethod === 'stratified' && <p>**Stratification** guarantees that every quadrant is exactly represented in the sample, driving down standard errors by removing group-level variance.</p>}
                  {selectedGridMethod === 'cluster' && <p>**Clustering** simplifies data collection logs (only visiting 2 cluster locations instead of 16 scattered units), but drastically inflates standard errors due to intracluster correlation.</p>}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* SUB-TAB 4: DESIGN EFFECTS SANDBOX */}
        {hubTab === 'deff' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-left">
            
            {/* Cluster Design Effect Section */}
            <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-6">
              <div className="border-b border-white/10 pb-3 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
                    KISH'S CLUSTER FORMULA
                  </span>
                  <h3 className="text-lg font-bold text-white mt-2">Cluster-Based Design Effect (Deff)</h3>
                </div>
                <Layers className="h-5 w-5 text-indigo-400 animate-pulse" />
              </div>

              <p className="text-xs text-gray-400 leading-relaxed">
                When sampling grouped items (clusters), individuals in the same cluster are usually more similar than random people. This is measured by the **Intracluster Correlation Coefficient (ICC, $\rho$)**. It inflates standard errors and shrinks our effective sample size.
              </p>

              <div className="bg-slate-950/60 p-4 rounded-xl border border-white/5 text-center font-mono">
                <p className="text-indigo-400 text-lg">Deff = 1 + (m - 1) × ρ</p>
                <p className="text-gray-500 text-[10px] mt-1">m = average cluster size | ρ = intracluster correlation (ICC)</p>
              </div>

              <div className="space-y-4 pt-2">
                {/* Cluster size m */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-400">Average Cluster Respondents (m)</span>
                    <span className="text-white font-mono">{deffM} units</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    value={deffM}
                    onChange={(e) => setDeffM(parseInt(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                {/* ICC rho */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-400">Intracluster Correlation Coefficient (ρ)</span>
                    <span className="text-white font-mono">{(deffRho * 100).toFixed(1)}% (ρ = {deffRho})</span>
                  </div>
                  <input
                    type="range"
                    min={0.0}
                    max={0.3}
                    step={0.01}
                    value={deffRho}
                    onChange={(e) => setDeffRho(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                {/* Sample Size */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-400">Drawn Sample Size (n)</span>
                    <span className="text-white font-mono">{deffSampleN} respondents</span>
                  </div>
                  <input
                    type="range"
                    min={100}
                    max={3000}
                    step={100}
                    value={deffSampleN}
                    onChange={(e) => setDeffSampleN(parseInt(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>

              {/* Dynamic Results Card */}
              <div className="bg-white/5 border border-white/5 p-5 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 font-semibold">Calculated Cluster Deff:</span>
                  <span className={`text-xl font-mono font-black ${kishClusterDeff > 2.0 ? 'text-red-400 animate-pulse' : kishClusterDeff > 1.2 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {kishClusterDeff.toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-2 text-xs">
                  <span className="text-gray-400">Effective Sample Size:</span>
                  <span className="text-white font-bold font-mono">{effectiveDeffSize} respondents</span>
                </div>
                <div className="text-[11px] text-gray-400 italic bg-gray-950/40 p-2.5 rounded-lg">
                  {kishClusterDeff > 2.0 
                    ? `⚠️ High Variance Inflation! Due to cluster homogeneities, your sample of ${deffSampleN} units provides the statistical power of only ${effectiveDeffSize} simple random selection points. You need to adjust your base sample size upwards!`
                    : `✓ Low to moderate variance inflation. Your drawn sample is highly efficient, representing ${effectiveDeffSize} SRS units.`
                  }
                </div>
              </div>
            </div>

            {/* Unequal Weighting Effect Section */}
            <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-6">
              <div className="border-b border-white/10 pb-3 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono font-bold text-pink-400 bg-pink-500/10 px-2.5 py-1 rounded-full border border-pink-500/20">
                    KISH'S WEIGHT EFFECT
                  </span>
                  <h3 className="text-lg font-bold text-white mt-2">Unequal Weighting Design Effect</h3>
                </div>
                <Scale className="h-5 w-5 text-pink-400 animate-pulse" />
              </div>

              <p className="text-xs text-gray-400 leading-relaxed">
                When weight calibration (raking) or non-response adjustments create highly diverse weights, statistical precision is degraded. Kish's weighting approximation represents this inflation in standard errors.
              </p>

              <div className="bg-slate-950/60 p-4 rounded-xl border border-white/5 text-center font-mono">
                <p className="text-pink-400 text-lg">Deff_weight = 1 + CV(w)²</p>
                <p className="text-gray-500 text-[10px] mt-1">CV = Coefficient of Variation of Survey Weights</p>
              </div>

              <div className="space-y-4 pt-2">
                {/* Subgroup weight disparity multiplier */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-400">Underrepresented Subgroup Weight Multiplier</span>
                    <span className="text-white font-mono">{uweSpread.toFixed(1)}x baseline</span>
                  </div>
                  <input
                    type="range"
                    min={1.0}
                    max={10.0}
                    step={0.5}
                    value={uweSpread}
                    onChange={(e) => setUweSpread(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-pink-500"
                  />
                </div>

                {/* Subgroup share */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-400">Share of Sample Receiving High Weight</span>
                    <span className="text-white font-mono">{(uweRatio * 100).toFixed(0)}% of sample</span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={0.5}
                    step={0.05}
                    value={uweRatio}
                    onChange={(e) => setUweRatio(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-pink-500"
                  />
                </div>
              </div>

              {/* Dynamic Results Card */}
              <div className="bg-white/5 border border-white/5 p-5 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 font-semibold">Unequal Weighting Deff (UWE):</span>
                  <span className={`text-xl font-mono font-black ${uweDeff > 1.5 ? 'text-red-400 animate-pulse' : uweDeff > 1.15 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {uweDeff.toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-white/10 pt-2 text-xs">
                  <span className="text-gray-400">Standard Error Inflation Factor:</span>
                  <span className="text-white font-bold font-mono">{(Math.sqrt(uweDeff) * 100 - 100).toFixed(1)}% standard error increase</span>
                </div>
                <div className="text-[11px] text-gray-400 italic bg-gray-950/40 p-2.5 rounded-lg">
                  {uweDeff > 1.5 
                    ? `⚠️ Runaway Variance! Weight calibration is severely inflating your standard errors. Enable Weight Trimming in the Weighting tab (e.g. cap at [0.3, 3.0]) to keep precision under control.`
                    : `✓ Weight variation is well controlled. Minimal design variance penalty due to calibration.`
                  }
                </div>
              </div>
            </div>

          </div>
        )}

        {/* SUB-TAB 5: RAKING IPF DEMONSTRATOR */}
        {hubTab === 'raking' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
            
            {/* Interactive sliders & targets */}
            <div className="lg:col-span-1 glass-panel border border-white/5 p-6 rounded-2xl space-y-5">
              <div className="border-b border-white/10 pb-2">
                <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Calibration Targets</h3>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed font-sans">
                Drag sliders to adjust population census targets. Total sum is fixed at 100 respondents. Click "Rake Step" to watch weights recalibrate iteratively. 
              </p>
              <p className="text-xs text-gray-400 leading-relaxed font-sans mt-2">
                This simulator demonstrates classical **Multiplicative Raking (IPF)**. In the main application's **Weighting & Calibration** tab, you can select between Multiplicative, Linear (GREG), or Bounded Logit solvers, applied either to drawn samples or custom uploaded fieldwork datasets.
              </p>

              <div className="space-y-4">
                {/* Gender Targets */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-indigo-300">Target Male Total</span>
                    <span className="text-white font-mono">{rakeTargets.male} / 100</span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={70}
                    step={2}
                    value={rakeTargets.male}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setRakeTargets(prev => ({ ...prev, male: val, female: 100 - val }));
                      handleResetRaking();
                    }}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>

                {/* Region Targets */}
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-pink-300">Target Urban Total</span>
                    <span className="text-white font-mono">{rakeTargets.urban} / 100</span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={70}
                    step={2}
                    value={rakeTargets.urban}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setRakeTargets(prev => ({ ...prev, urban: val, rural: 100 - val }));
                      handleResetRaking();
                    }}
                    className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-pink-500"
                  />
                </div>
              </div>

              {/* Raking Actions */}
              <div className="border-t border-white/10 pt-4 flex gap-2">
                <button
                  onClick={handleRakeStep}
                  className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs hover-lift transition-all flex items-center justify-center gap-1.5"
                >
                  <Play className="h-3 w-3 fill-white" />
                  Rake Step
                </button>
                <button
                  onClick={handleResetRaking}
                  className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 font-semibold text-xs hover-lift transition-all"
                  title="Reset Weighting Grid"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Live Quality Box */}
              <div className="bg-white/5 border border-white/5 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400 font-semibold">Current Step:</span>
                  <span className="text-indigo-400 font-bold font-mono">Step #{rakeStep} ({rakeStep % 2 === 0 ? 'Ready for Gender' : 'Ready for Region'})</span>
                </div>
                <div className="flex items-center justify-between text-xs border-t border-white/10 pt-1.5">
                  <span className="text-gray-400 font-semibold">Max Deviation Error:</span>
                  <span className={`font-bold font-mono ${maxDiscrepancyPct > 10.0 ? 'text-red-400 animate-pulse' : maxDiscrepancyPct > 0.1 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {maxDiscrepancyPct.toFixed(2)}%
                  </span>
                </div>
              </div>

            </div>

            {/* Raking Grid and execution logs */}
            <div className="lg:col-span-2 space-y-4">
              
              {/* Raking cell grid */}
              <div className="glass-panel border border-white/5 rounded-2xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
                    IPF CALIBRATION WEIGHTS MATRIX
                  </span>
                  {maxDiscrepancyPct < 0.1 && (
                    <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 animate-bounce">
                      CONVERGED (ERROR &lt; 0.1%)
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/5">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-white/5 text-gray-300 font-mono border-b border-white/10">
                        <th className="p-3 font-semibold">Demographics</th>
                        <th className="p-3 font-semibold">Urban (Cell counts)</th>
                        <th className="p-3 font-semibold">Rural (Cell counts)</th>
                        <th className="p-3 font-semibold bg-indigo-500/5 text-indigo-300">Weighted Total</th>
                        <th className="p-3 font-semibold text-indigo-400">Target Census</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      <tr>
                        <td className="p-3 text-white font-bold font-sans">Male (Base n=40)</td>
                        <td className="p-3 text-gray-300">{(rakeCells.maleUrban).toFixed(2)} <span className="text-[10px] text-gray-500">(n=30)</span></td>
                        <td className="p-3 text-gray-300">{(rakeCells.maleRural).toFixed(2)} <span className="text-[10px] text-gray-500">(n=10)</span></td>
                        <td className="p-3 bg-indigo-500/5 text-white font-bold">{currentMaleSum.toFixed(2)}</td>
                        <td className="p-3 text-indigo-400 font-bold">{rakeTargets.male}.00</td>
                      </tr>
                      <tr>
                        <td className="p-3 text-white font-bold font-sans">Female (Base n=60)</td>
                        <td className="p-3 text-gray-300">{(rakeCells.femaleUrban).toFixed(2)} <span className="text-[10px] text-gray-500">(n=20)</span></td>
                        <td className="p-3 text-gray-300">{(rakeCells.femaleRural).toFixed(2)} <span className="text-[10px] text-gray-500">(n=40)</span></td>
                        <td className="p-3 bg-indigo-500/5 text-white font-bold">{currentFemaleSum.toFixed(2)}</td>
                        <td className="p-3 text-indigo-400 font-bold">{rakeTargets.female}.00</td>
                      </tr>
                      <tr className="bg-white/5 font-bold">
                        <td className="p-3 text-white font-sans">Weighted Total</td>
                        <td className="p-3 text-white font-mono">{currentUrbanSum.toFixed(2)}</td>
                        <td className="p-3 text-white font-mono">{currentRuralSum.toFixed(2)}</td>
                        <td className="p-3 text-white">{(currentMaleSum + currentFemaleSum).toFixed(2)}</td>
                        <td className="p-3 text-indigo-400">100.00</td>
                      </tr>
                      <tr className="font-bold font-sans">
                        <td className="p-3 text-pink-400">Target Census</td>
                        <td className="p-3 text-pink-400 font-mono">{rakeTargets.urban}.00</td>
                        <td className="p-3 text-pink-400 font-mono">{rakeTargets.rural}.00</td>
                        <td className="p-3 text-pink-400">100.00</td>
                        <td className="p-3 text-gray-600">-</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Raking Logs Console */}
              <div className="bg-gray-950/80 rounded-2xl border border-white/5 p-4 h-36 overflow-y-auto font-mono text-[10px] text-gray-400 space-y-1.5 scrollbar-thin">
                <span className="text-[9px] text-indigo-300 font-bold uppercase tracking-wider block font-sans mb-1">ipf convergence trace logs:</span>
                {rakeLogs.map((log, idx) => (
                  <p key={idx} className={idx === rakeLogs.length - 1 ? "text-indigo-400 font-bold" : ""}>
                    &gt; {log}
                  </p>
                ))}
              </div>

            </div>
          </div>
        )}

        {/* SUB-TAB 6: SURVEY DESIGNER METHODOLOGY QUIZ */}
        {hubTab === 'quiz' && (
          <div className="glass-panel border border-white/5 rounded-2xl p-6 text-left max-w-2xl mx-auto space-y-6">
            
            {!showQuizResult ? (
              <div className="space-y-6">
                
                {/* Quiz Header & progress */}
                <div className="border-b border-white/10 pb-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
                      SURVEY DESIGN DIAGNOSTIC QUIZ
                    </span>
                    <span className="text-gray-400">Question {quizStep + 1} of {quizQuestions.length}</span>
                  </div>
                  <div className="w-full bg-gray-800 h-1.5 rounded-full mt-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-indigo-500 to-pink-500 h-full transition-all duration-300"
                      style={{ width: `${((quizStep) / quizQuestions.length) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Question */}
                <div className="space-y-4">
                  <h3 className="text-base font-bold text-white leading-relaxed">
                    {quizQuestions[quizStep].q}
                  </h3>

                  <div className="space-y-2">
                    {quizQuestions[quizStep].options.map((opt, optIdx) => (
                      <button
                        key={optIdx}
                        onClick={() => handleQuizAnswer(optIdx)}
                        className="w-full text-left p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/10 text-xs font-semibold text-gray-200 transition-all hover-lift flex items-center justify-between"
                      >
                        <span>{opt}</span>
                        <ChevronRight className="h-4 w-4 text-gray-500" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reset button */}
                {quizStep > 0 && (
                  <button
                    onClick={handleResetQuiz}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 font-semibold"
                  >
                    <RotateCcw className="h-3 w-3" /> Start Over
                  </button>
                )}

              </div>
            ) : (() => {
              const blueprint = getDiagnosticBlueprint();
              return (
                <div className="space-y-6">
                  
                  <div className="border-b border-white/10 pb-4 text-center">
                    <div className="h-12 w-12 bg-indigo-500/10 rounded-full flex items-center justify-center border border-indigo-500/20 mx-auto">
                      <Award className="h-6 w-6 text-indigo-400 animate-bounce" />
                    </div>
                    <h3 className="text-xl font-extrabold text-white mt-3">Study Design Blueprint Generated</h3>
                    <p className="text-xs text-gray-400 mt-1">Custom statistical blueprint calibrated to your survey requirements</p>
                  </div>

                  <div className="space-y-4 text-xs">
                    
                    {/* Recommendation blueprint boxes */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-indigo-600/10 border border-indigo-500/20 p-4 rounded-xl">
                        <span className="text-[10px] text-gray-500 font-mono font-bold block uppercase">Recommended Sampling</span>
                        <p className="text-xs text-white font-bold mt-1.5">{blueprint.sampling}</p>
                      </div>

                      <div className="bg-pink-600/10 border border-pink-500/20 p-4 rounded-xl">
                        <span className="text-[10px] text-gray-500 font-mono font-bold block uppercase">Weighting Adjustment</span>
                        <p className="text-xs text-white font-bold mt-1.5 text-wrap">{blueprint.weighting}</p>
                      </div>

                      <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl">
                        <span className="text-[10px] text-gray-500 font-mono font-bold block uppercase">Variance SE Method</span>
                        <p className="text-xs text-white font-bold mt-1.5">{blueprint.variance}</p>
                      </div>
                    </div>

                    <div className="bg-white/5 border border-white/5 p-5 rounded-xl space-y-3">
                      <h4 className="font-bold text-white font-mono uppercase tracking-wider text-[10px] text-indigo-300">Methodology Rationale:</h4>
                      <p className="text-gray-300 leading-relaxed">{blueprint.summaryText}</p>
                    </div>

                    {/* Step-by-step instructions */}
                    <div className="border border-white/5 bg-slate-950/40 p-5 rounded-2xl space-y-4">
                      <h4 className="font-bold text-white">How to execute this design in Mr_Ed' Sampling Suite:</h4>
                      
                      <div className="space-y-3">
                        <div className="flex gap-3">
                          <div className="h-5 w-5 rounded bg-indigo-600 text-white font-mono font-bold text-xs flex items-center justify-center shrink-0">1</div>
                          <div>
                            <p className="font-semibold text-white">Load Frame & Allocate sizes</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">Go to **Size & Allocation**, calculate baseline size using Cochran, and execute Stratum Allocations (Proportional or Neyman).</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="h-5 w-5 rounded bg-indigo-600 text-white font-mono font-bold text-xs flex items-center justify-center shrink-0">2</div>
                          <div>
                            <p className="font-semibold text-white">Execute Drawing</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">Go to **Sampling Console**, select your design method (e.g. Stratified Systematic) matching your allocated strata quotas, and click **Execute Draw**.</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="h-5 w-5 rounded bg-indigo-600 text-white font-mono font-bold text-xs flex items-center justify-center shrink-0">3</div>
                          <div>
                            <p className="font-semibold text-white">Calibrate and model weights</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">Under **Weighting & Calibration**, configure response propensities for active non-responses, add your raking margins, and execute Calibration.</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="h-5 w-5 rounded bg-indigo-600 text-white font-mono font-bold text-xs flex items-center justify-center shrink-0">4</div>
                          <div>
                            <p className="font-semibold text-white">Estimate variances</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">Under **Variance & Analytics**, choose your target estimator, and run design-based Taylor linearization or resample replicate weights to extract correct Standard Errors.</p>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Diagnostic actions */}
                  <div className="flex gap-3 border-t border-white/10 pt-4 bg-gray-950/20 px-2 rounded-xl mt-6">
                    <button
                      onClick={handleResetQuiz}
                      className="px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 font-semibold text-xs hover-lift transition-all"
                    >
                      Retake Diagnostic Quiz
                    </button>
                    <button
                      onClick={() => setActiveTab(blueprint.linkTab)}
                      className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs hover-lift transition-all flex items-center justify-center gap-1.5"
                    >
                      <Play className="h-3 w-3 fill-white" />
                      Apply and Jump to Setup Tab
                    </button>
                  </div>

                </div>
              );
            })()}

          </div>
        )}

      </div>

    </div>
  );
}
