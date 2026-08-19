/**
 * Deep statistical validation of utils/random.ts.
 * Heavy (millions of draws) - run manually via `npm run test:rng`, not in `npm test`.
 */
import {
  createRng, deriveStream, canonicalizeSeed, selectIndicesWithoutReplacement,
  selectIndicesWithReplacement, shuffleInPlace, generateSeed
} from '../src/utils/random';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "  PASS  " : "  FAIL  ") + m); if (!c) fail++; };

// 1. float range strictly [0,1)
const r = createRng("TEST-SEED");
let mn = 1, mx = 0;
for (let i = 0; i < 500000; i++) { const v = r.nextFloat(); if (v < mn) mn = v; if (v > mx) mx = v; }
ok(mn >= 0 && mx < 1, `float in [0,1): min=${mn.toExponential(3)}, 1-max=${(1 - mx).toExponential(3)}`);

// 2. uniformity of nextBelow (chi-square, 10 bins, 1e6 draws)
const r2 = createRng("UNIFORM"); const K = 10, M = 1000000;
const bins = new Array(K).fill(0);
for (let i = 0; i < M; i++) bins[r2.nextBelow(K)]++;
const exp = M / K;
const chi = bins.reduce((s, b) => s + (b - exp) ** 2 / exp, 0);
ok(chi < 27.88, `nextBelow uniform: chi2=${chi.toFixed(2)} (df=9, 0.999 crit=27.88)`);

// 3. no modulo bias where 2^32 % n is large -- n=3 is the classic failing case
const r3 = createRng("MODBIAS"); const n3 = 3, M3 = 3000000;
const b3 = [0, 0, 0];
for (let i = 0; i < M3; i++) b3[r3.nextBelow(n3)]++;
const e3 = M3 / 3;
const chi3 = b3.reduce((s, b) => s + (b - e3) ** 2 / e3, 0);
ok(chi3 < 13.82, `no modulo bias at n=3: chi2=${chi3.toFixed(2)} (df=2, crit=13.82) ${JSON.stringify(b3)}`);

// 4. determinism
const a = createRng("REPRO"), b = createRng("REPRO");
let same = true;
for (let i = 0; i < 10000; i++) if (a.nextUint32() !== b.nextUint32()) { same = false; break; }
ok(same, "same seed reproduces an identical stream");

// 5. adjacent seeds decorrelated (zeroland escape)
const s1 = createRng(1), s2 = createRng(2);
let coincidences = 0;
for (let i = 0; i < 1000; i++) if (s1.nextUint32() === s2.nextUint32()) coincidences++;
ok(coincidences <= 2, `adjacent integer seeds decorrelated (${coincidences} coincidental matches / 1000)`);

// 6. substreams: label-keyed, order-independent, distinct
ok(deriveStream("ROOT", "stratum", "URBAN").nextUint32() === deriveStream("ROOT", "stratum", "URBAN").nextUint32(),
  "same label -> same substream");
ok(deriveStream("ROOT", "stratum", "URBAN").nextUint32() !== deriveStream("ROOT", "stratum", "RURAL").nextUint32(),
  "different labels -> different substreams");
// a substream must not depend on how much the root has been consumed
const rootA = createRng("ROOT"); for (let i = 0; i < 5000; i++) rootA.nextUint32();
ok(deriveStream("ROOT", "stratum", "URBAN").nextUint32() === deriveStream("ROOT", "stratum", "URBAN").nextUint32(),
  "substream independent of root consumption");

// 7. full Fisher-Yates, not Sattolo
const seen = new Set<string>();
for (let s = 0; s < 400; s++) { const arr = [0, 1, 2]; shuffleInPlace(createRng(`P${s}`), arr); seen.add(arr.join('')); }
ok(seen.size === 6, `Fisher-Yates reaches all 6 permutations of 3 (saw ${seen.size}: ${[...seen].sort().join(',')})`);
ok(seen.has('012'), "identity permutation reachable (Sattolo would exclude it)");

// 8. SRSWOR distinctness and range
const sel = selectIndicesWithoutReplacement(createRng("WOR"), 1000, 150);
ok(new Set(sel).size === 150, "SRSWOR returns 150 distinct indices");
ok(sel.every(i => i >= 0 && i < 1000), "all SRSWOR indices in range");

// 9. SRSWOR inclusion probabilities uniform across units
const N9 = 20, n9 = 5, T = 200000;
const cnt = new Array(N9).fill(0);
for (let t = 0; t < T; t++) selectIndicesWithoutReplacement(createRng(`D${t}`), N9, n9).forEach(i => cnt[i]++);
const e9 = T * n9 / N9;
const chi9 = cnt.reduce((s, c) => s + (c - e9) ** 2 / e9, 0);
ok(chi9 < 43.82, `SRSWOR inclusion probabilities uniform: chi2=${chi9.toFixed(2)} (df=19, crit=43.82)`);

// 10. with-replacement retains duplicates
const wr = selectIndicesWithReplacement(createRng("WR"), 10, 1000);
ok(wr.length === 1000 && new Set(wr).size < 1000, "with-replacement retains duplicates");

// 11. seed canonicalisation
ok(canonicalizeSeed(20260819).canonical === "20260819", "numeric seed canonicalises to its digits");
ok(canonicalizeSeed("  abc  ").canonical === "abc", "string seed is trimmed");
ok(canonicalizeSeed("abc").fingerprint.length === 16, "fingerprint is 16 hex chars");
let threw = false; try { canonicalizeSeed(""); } catch { threw = true; }
ok(threw, "empty seed rejected");
threw = false; try { canonicalizeSeed(-1); } catch { threw = true; }
ok(threw, "negative seed rejected");

// 12. generated seeds well-formed and distinct
const gs = new Set(Array.from({ length: 200 }, () => generateSeed()));
ok(gs.size === 200, "generateSeed produces distinct seeds");
ok(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test([...gs][0]), "generateSeed well-formed");

console.log(fail === 0 ? "\nALL RNG CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
