/**
 * Official Statistics Sampling & Weighting System - Seeded Random Number Generator
 *
 * Every probability sample this application draws must be reproducible from a recorded
 * seed. A sample that cannot be regenerated cannot be audited, and an estimate produced
 * from an unauditable sample cannot be defended. `Math.random()` is unseedable by
 * specification, so it is not usable anywhere in the draw or replication path.
 *
 * ALGORITHM: xoshiro128** (Blackman & Vigna, 2018). 128 bits of state held as four
 * uint32, 32 bits of output per step. Seeds are canonicalised to a UTF-8 string, hashed
 * with FNV-1a-64, and expanded to the full 128-bit state through triple32 (Wellons), a
 * bijective avalanche mixer. The expansion matters: loading a small integer seed
 * directly into an F2-linear generator's state leaves it in "zeroland", where early
 * output is visibly correlated with the seed and adjacent seeds produce adjacent streams.
 *
 * TRANSCRIPTION RULES (violating any of these silently biases every estimate):
 *   - `>>> 0` on every value leaving an arithmetic step. NEVER `| 0` -- that flips sign
 *     at the 2^31 boundary and is the most common bug in ports of this generator.
 *   - `Math.imul` for every 32-bit multiply, including the *5 and *9 in the scrambler.
 *   - State lives in a Uint32Array, which coerces on store.
 *
 * REPRODUCIBILITY MODEL: substreams are keyed by canonical LABEL, not by index or by
 * jump count -- `deriveStream(seed, 'stratum', 'URBAN-07')`. This is what makes a draw
 * invariant to iteration order. `Object.keys()` reorders integer-like keys into ascending
 * numeric order regardless of insertion order, so an index-keyed scheme would produce a
 * different sample for the same seed purely because a stratum was renamed "07" instead
 * of "URBAN-07". Label keying removes that entire class of failure, and it also means
 * adding a stratum does not disturb the draws of any other stratum.
 */

export const RNG_ALGORITHM_ID = 'xoshiro128starstar/triple32/fnv1a64/v1';

export class RngSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RngSeedError';
  }
}

export class RngRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RngRangeError';
  }
}

/** A seed as a human types or stores it. Numbers must be non-negative safe integers. */
export type SeedInput = string | number;

export interface CanonicalSeed {
  /** The exact string that was hashed. This is what belongs in a methodology annex. */
  readonly canonical: string;
  /** Low and high halves of the FNV-1a-64 digest. */
  readonly k0: number;
  readonly k1: number;
  /** 16 lowercase hex characters, for display and audit. */
  readonly fingerprint: string;
}

export interface Rng {
  /** One xoshiro128** step. Integer in [0, 2^32). */
  nextUint32(): number;
  /** Consumes two words. Exactly [0, 1): 0 attainable, 1 unattainable, 2^53 atoms. */
  nextFloat(): number;
  /** Alias of nextFloat, named where the half-open interval is load-bearing. */
  nextUnitInterval(): number;
  /** Uniform integer in [0, n). Exactly uniform -- rejection sampled, no modulo bias. */
  nextBelow(n: number): number;
  /** uint32 words consumed since construction. Used for drift detection in tests. */
  drawCount(): number;
  /** Stream label, for the audit trail. */
  readonly label: string;
}

/* ------------------------------------------------------------------ *
 * 64-bit helpers, in exact 32-bit arithmetic (no BigInt)
 * ------------------------------------------------------------------ */

/** (a * b) mod 2^64, with both operands and the result as {hi, lo} uint32 pairs. */
function mul64(aHi: number, aLo: number, bHi: number, bLo: number): [number, number] {
  // Full 64-bit product of the two low words, via 16-bit limbs so every
  // intermediate stays exactly representable in a float64.
  const a0 = aLo & 0xffff;
  const a1 = aLo >>> 16;
  const b0 = bLo & 0xffff;
  const b1 = bLo >>> 16;

  const p00 = a0 * b0;              // < 2^32
  const mid = a0 * b1 + a1 * b0;    // < 2^33
  const p11 = a1 * b1;              // < 2^32

  const midLo = mid % 65536;
  const midHi = Math.floor(mid / 65536);

  let low = p00 + midLo * 65536;    // < 2^33
  const carry = Math.floor(low / 4294967296);
  low = low % 4294967296;

  // Cross terms only affect the high word (they are already shifted by 2^32).
  const high = (p11 + midHi + carry
    + (Math.imul(aLo, bHi) >>> 0)
    + (Math.imul(aHi, bLo) >>> 0)) % 4294967296;

  return [high >>> 0, low >>> 0];
}

/** FNV-1a-64 over the UTF-8 bytes of `str`. Returns [k0 (low), k1 (high)]. */
function fnv1a64(str: string): [number, number] {
  const bytes = new TextEncoder().encode(str);
  // offset basis 0xcbf29ce484222325
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  // prime 0x100000001b3
  const pHi = 0x00000100;
  const pLo = 0x000001b3;

  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]) >>> 0;
    const [nHi, nLo] = mul64(hi, lo, pHi, pLo);
    hi = nHi;
    lo = nLo;
  }
  return [lo >>> 0, hi >>> 0];
}

/**
 * triple32 (Chris Wellons). Bijective 32-bit mixer with measured avalanche bias ~0.
 * Used to expand a 64-bit key into 128 bits of well-separated state.
 */
function triple32(x: number): number {
  x = x >>> 0;
  x ^= x >>> 17;
  x = Math.imul(x, 0xed5ad4bb) >>> 0;
  x ^= x >>> 11;
  x = Math.imul(x, 0xac4c1b51) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x31848bab) >>> 0;
  x ^= x >>> 14;
  return x >>> 0;
}

function rotl(x: number, k: number): number {
  return (((x << k) | (x >>> (32 - k))) >>> 0);
}

/* ------------------------------------------------------------------ *
 * Seed canonicalisation
 * ------------------------------------------------------------------ */

/**
 * The single place a seed becomes bytes. Deterministic and total.
 *
 * Rules (these belong in the methodology annex, because an auditor reproducing the
 * draw in R or Python has to apply exactly the same ones):
 *   - a number must be a non-negative safe integer and is rendered with String(n)
 *   - a string is NFC-normalised and trimmed, and must be non-empty
 */
export function canonicalizeSeed(seed: SeedInput): CanonicalSeed {
  let canonical: string;

  if (typeof seed === 'number') {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new RngSeedError(
        `Seed must be a non-negative whole number below 2^53. Received: ${seed}`
      );
    }
    canonical = String(seed);
  } else if (typeof seed === 'string') {
    canonical = seed.normalize('NFC').trim();
    if (canonical.length === 0) {
      throw new RngSeedError('Seed cannot be empty. Enter a seed or generate one.');
    }
  } else {
    throw new RngSeedError('Seed must be a string or a non-negative whole number.');
  }

  const [k0, k1] = fnv1a64(canonical);
  const fingerprint =
    k1.toString(16).padStart(8, '0') + k0.toString(16).padStart(8, '0');

  return { canonical, k0, k1, fingerprint };
}

/* ------------------------------------------------------------------ *
 * The generator
 * ------------------------------------------------------------------ */

class Xoshiro128SS implements Rng {
  private s: Uint32Array;
  private consumed = 0;
  public readonly label: string;

  constructor(k0: number, k1: number, label: string) {
    const s = new Uint32Array(4);
    // Expand 64 key bits into 128 state bits. Every state word passes through
    // triple32, so no part of the state is a raw function of the seed.
    for (let i = 0; i < 4; i++) {
      s[i] = triple32(
        (triple32((k0 ^ Math.imul(2 * i + 1, 0x9e3779b9)) >>> 0)
          ^ triple32((k1 ^ Math.imul(2 * i + 2, 0x85ebca6b)) >>> 0)) >>> 0
      );
    }
    // xoshiro is F2-linear: the all-zero state is a fixed point and would emit
    // zeros forever. Astronomically unlikely, but a guard costs nothing.
    if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) {
      s[0] = 0x9e3779b9;
    }
    this.s = s;
    this.label = label;
  }

  nextUint32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;

    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);

    this.consumed++;
    return result;
  }

  /**
   * Canonical 53-bit construction, bit-identical to CPython's random.random() and
   * NumPy's legacy random_sample. Range is exactly [0, 1).
   *
   * The upper bound being unattainable is load-bearing, not cosmetic: the systematic
   * draw computes a random start in [0, k) and relies on `start + (n-1)*k < N` to
   * guarantee the last index is in range. A generator that could return exactly 1.0
   * would index past the end of the frame.
   */
  nextFloat(): number {
    const hi = this.nextUint32();
    const lo = this.nextUint32();
    return ((hi >>> 5) * 67108864 + (lo >>> 6)) / 9007199254740992;
  }

  nextUnitInterval(): number {
    return this.nextFloat();
  }

  /**
   * Uniform integer in [0, n), exactly uniform.
   *
   * OpenBSD-style rejection. `limit` is the largest multiple of n that fits in 2^32,
   * so the accepted range is an exact multiple of n and `% n` is unbiased. The naive
   * `nextUint32() % n` over-represents small values; Lemire's multiply-shift is the
   * usual fix but needs a true 32x32->64 product, which JS cannot do without limb
   * decomposition, and it degrades silently above n = 2^21 if written naively.
   * Rejection costs about 0.02% extra draws at n = 10^6 -- not worth optimising away.
   */
  nextBelow(n: number): number {
    if (!Number.isSafeInteger(n) || n <= 0 || n > 4294967296) {
      throw new RngRangeError(`nextBelow(n) requires 0 < n <= 2^32. Received: ${n}`);
    }
    // n === 1 consumes zero words. Documented because it affects stream alignment.
    if (n === 1) return 0;

    const limit = 4294967296 - (4294967296 % n);
    let x = this.nextUint32();
    while (x >= limit) {
      x = this.nextUint32();
    }
    return x % n;
  }

  drawCount(): number {
    return this.consumed;
  }
}

/** Root stream for a seed. */
export function createRng(seed: SeedInput, label = 'root'): Rng {
  const { k0, k1 } = canonicalizeSeed(seed);
  return new Xoshiro128SS(k0, k1, label);
}

/**
 * Derive an independent substream, keyed by a canonical label path.
 *
 * Hashes the ROOT seed, never a parent's current state, so a substream is independent
 * of how many variates anything else has consumed. That is the property that makes a
 * stratified draw invariant to the order strata happen to be iterated in.
 */
export function deriveStream(
  rootSeed: SeedInput,
  domain: string,
  key: string | number
): Rng {
  const root = canonicalizeSeed(rootSeed);
  const canonicalKey = typeof key === 'number' ? String(key) : key.normalize('NFC');
  const path = `mred/v1|${root.canonical}|${domain}|${canonicalKey}`;
  const [k0, k1] = fnv1a64(path);
  return new Xoshiro128SS(k0, k1, `${domain}:${canonicalKey}`);
}

/* ------------------------------------------------------------------ *
 * Selection primitives
 * ------------------------------------------------------------------ */

/**
 * Full Fisher-Yates, downward form.
 *
 * The `i + 1` is correctness-critical. `nextBelow(i)` produces Sattolo's algorithm,
 * which generates only full cycles -- a strict subset of permutations -- and would
 * silently bias every draw. Do not "simplify" it.
 */
export function shuffleInPlace<T>(rng: Rng, a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextBelow(i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
}

/**
 * n distinct indices from [0, N), returned in DRAW ORDER.
 *
 * Partial Fisher-Yates over the first n positions, consuming exactly n words in the
 * same order a full shuffle would. Sorting is deliberately left to the caller: draw
 * order is the methodologically meaningful order, ascending order is a presentation
 * choice, and conflating them makes the two impossible to tell apart in an audit.
 */
export function selectIndicesWithoutReplacement(
  rng: Rng,
  N: number,
  n: number
): number[] {
  if (n > N) {
    throw new RngRangeError(
      `Cannot draw ${n} distinct units from a frame of ${N} without replacement.`
    );
  }
  const idx = new Array<number>(N);
  for (let i = 0; i < N; i++) idx[i] = i;

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = i + rng.nextBelow(N - i);
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
    out.push(idx[i]);
  }
  return out;
}

/** n independent draws from [0, N) with replacement, in draw order, duplicates kept. */
export function selectIndicesWithReplacement(
  rng: Rng,
  N: number,
  n: number
): number[] {
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.nextBelow(N);
  return out;
}

/* ------------------------------------------------------------------ *
 * Seed generation for the UI
 * ------------------------------------------------------------------ */

const SEED_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I

/**
 * A fresh, human-transcribable seed, e.g. "K4T9-QM2X-7BHD".
 *
 * The entropy source here does not need to be reproducible -- the generated seed is
 * shown to the user and recorded, and it is the seed, not its origin, that reproduces
 * the sample.
 */
export function generateSeed(): string {
  const bytes = new Uint8Array(12);
  const g: any = globalThis;
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    g.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const chars = Array.from(bytes, b => SEED_ALPHABET[b % SEED_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}
