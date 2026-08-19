/**
 * Official Statistics Sampling & Weighting System - Distribution Functions
 *
 * Confidence intervals from complex surveys use Student's t with DESIGN degrees of
 * freedom, not the normal quantile 1.96. With few primary sampling units the
 * difference is material: at df = 15 the correct multiplier is 2.131, so an interval
 * built on 1.96 is about 8% too narrow and its true coverage is below the stated 95%.
 *
 * Implemented from scratch (no dependency) via the regularized incomplete beta
 * function, using the Lentz continued-fraction evaluation.
 */

/** Log-gamma via the Lanczos approximation. Accurate to ~15 significant figures. */
export function logGamma(x: number): number {
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += g[j] / ++y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/**
 * Continued fraction for the incomplete beta function (Numerical Recipes `betacf`,
 * evaluated by the modified Lentz method).
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAXIT = 300;
  const EPS = 3e-16;
  const FPMIN = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;

    // even step
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    // odd step
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lbeta);

  // The continued fraction converges quickly only for x < (a+1)/(a+b+2);
  // use the symmetry relation otherwise.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b)
    + b * Math.log(1 - x) + a * Math.log(x)
  ) * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Cumulative distribution function of Student's t with `df` degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (df <= 0) return NaN;
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** Standard normal quantile (Acklam's rational approximation, ~1e-9 absolute error). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) return NaN;

  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];

  const pLow = 0.02425;
  let q: number;
  let r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
    / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Quantile of Student's t: the value q with P(T <= q) = p.
 *
 * Solved by bisection on the CDF, which is monotone, so this is unconditionally
 * robust. Falls back to the normal quantile for very large df, where the two agree
 * to well beyond the precision anyone reports.
 */
export function studentTQuantile(p: number, df: number): number {
  if (p <= 0 || p >= 1) return NaN;
  if (!Number.isFinite(df) || df > 1e6) return normalQuantile(p);
  if (df <= 0) return NaN;

  let lo = -1e3;
  let hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

/**
 * Two-sided critical value for a confidence interval.
 *
 * @param confidence e.g. 0.95
 * @param df design degrees of freedom; pass Infinity for the normal approximation
 */
export function criticalValue(confidence: number, df: number): number {
  const p = 1 - (1 - confidence) / 2;
  return studentTQuantile(p, df);
}
