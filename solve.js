// RapidDiff — a fast drop-in for makefun-diff 1.0.0.
//
// run(input) returns exactly the answer makefun-diff 1.0.0 returns for the
// same input: make.fun's own patch of { old, new }, two texts, as one JSON
// string. The algorithm follows the rule in the house baseline's header word
// for word: common prefix, then common suffix, then Myers's greedy search
// that keeps, on each diagonal, the path reaching furthest into the old text
// and takes the deletion when a deletion and an insertion reach the same
// point, never moves past either text's end, prunes no edge diagonal, and
// follows every run of equal lines as far as it goes; the first path to
// reach both ends is the script.
//
// Speed comes from representation, not from a different algorithm:
//   - every distinct line is interned once to a small integer id, so the
//     search compares integers instead of strings;
//   - the search runs on flat Int32Array diagonals with no allocation in
//     its inner loop (the reference builds a linked path object per step);
//   - the V array of every edit distance is kept as one Int32Array per
//     distance, and the edit script is recovered by walking that trace
//     backwards, which reproduces the reference's path exactly.
//
// Nothing here reads the network, the environment, or any file: the whole
// entry is this module plus the driver that calls it.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** Run kinds. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) break;
    lines.push(text.slice(start, nl + 1));
    start = nl + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/**
 * The runs of the edit script of the middle region a[0..n) into b[0..m),
 * as [{ kind, count }] in order, by the reference's rule. a and b hold the
 * interned line ids; equal ids are equal lines.
 */
function editRuns(a, b, n, m) {
  // The trace: trace[d] is an Int32Array of length 2d + 1; entry k + d is
  // the number of old lines consumed by the furthest path of d edits on
  // diagonal k after following its run of equal lines, or -1 when no path
  // of d edits reaches that diagonal.
  const trace = [];

  // d = 0: the run of equal lines from the start of both texts.
  let cur = new Int32Array(1);
  let x = 0;
  let y = 0;
  while (x < n && y < m && a[x] === b[y]) {
    x++;
    y++;
  }
  cur[0] = x;
  trace.push(cur);
  if (x >= n && y >= m) return [{ kind: KEEP, count: n }];

  let foundD = -1;
  let foundK = 0;
  const maxEdit = n + m;
  outer: for (let d = 1; d <= maxEdit; d++) {
    cur = new Int32Array(2 * d + 1);
    const prev = trace[d - 1];
    const prevLen = 2 * d - 1;
    for (let i = 0; i <= 2 * d; i += 2) {
      const k = i - d;
      // The deletion candidate comes from diagonal k - 1 (prev index i - 2),
      // the insertion candidate from diagonal k + 1 (prev index i).
      const pd = i >= 2 ? prev[i - 2] : -1;
      const pi = i < prevLen ? prev[i] : -1;
      // A move past the end of either text is no candidate.
      const canDel = pd >= 0 && pd < n;
      const canIns = pi >= 0 && pi - (k + 1) < m;
      let xx;
      // The candidate further into the old text, and the deletion when
      // both reach the same point: one old line past pd is pd + 1, one new
      // line past pi leaves the old position at pi.
      if (canDel && (!canIns || pd + 1 >= pi)) xx = pd + 1;
      else if (canIns) xx = pi;
      else {
        cur[i] = -1;
        continue;
      }
      let yy = xx - k;
      while (xx < n && yy < m && a[xx] === b[yy]) {
        xx++;
        yy++;
      }
      cur[i] = xx;
      if (xx >= n && yy >= m) {
        foundD = d;
        foundK = k;
        break outer;
      }
    }
    trace.push(cur);
  }
  if (foundD === -1) throw new Error('RapidDiff: the search ended without reaching both ends');

  // Walk the trace backwards from the first path to reach both ends.
  // rev holds [kind, count] pairs in reverse order: at each distance the
  // run of kept lines the path followed, then the one edit that got it
  // there; the d = 0 run of kept lines closes the walk.
  const rev = [];
  x = n;
  y = m;
  for (let d = foundD; d >= 1; d--) {
    const k = x - y;
    const pv = trace[d - 1];
    const pvLen = 2 * d - 1;
    const di = k + d - 2;
    const ii = k + d;
    const pd = di >= 0 && di < pvLen ? pv[di] : -1;
    const pi = ii >= 0 && ii < pvLen ? pv[ii] : -1;
    const canDel = pd >= 0 && pd < n;
    const canIns = pi >= 0 && pi - (k + 1) < m;
    let x0;
    let isDel;
    if (canDel && (!canIns || pd + 1 >= pi)) {
      x0 = pd + 1;
      isDel = true;
    } else if (canIns) {
      x0 = pi;
      isDel = false;
    } else {
      throw new Error('RapidDiff: the trace holds no path to the start');
    }
    const kept = x - x0;
    if (kept > 0) rev.push([KEEP, kept]);
    rev.push([isDel ? DELETE : INSERT, 1]);
    if (isDel) {
      x = pd;
      y = pd - (k - 1);
    } else {
      x = pi;
      y = pi - (k + 1);
    }
  }
  if (x > 0) rev.push([KEEP, x]);

  // Reverse and merge runs of one kind.
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const [kind, count] = rev[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else runs.push({ kind, count });
  }
  return runs;
}

/** make.fun's own patch of input.old into input.new, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('RapidDiff: the input is { old, new }, two strings');
  }
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;

  // Intern every distinct line once, so the search compares integers.
  const ids = new Map();
  let nextId = 0;
  const intern = (lines) => {
    const out = new Int32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i];
      let id = ids.get(s);
      if (id === undefined) {
        id = nextId++;
        ids.set(s, id);
      }
      out[i] = id;
    }
    return out;
  };
  const ai = intern(a);
  const bi = intern(b);

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && ai[prefix] === bi[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && ai[n - 1 - suffix] === bi[m - 1 - suffix]) suffix++;

  const midN = n - prefix - suffix;
  const midM = m - prefix - suffix;
  let runs;
  if (midN === 0 && midM === 0) {
    runs = [];
  } else if (midN === 0) {
    runs = [{ kind: INSERT, count: midM }];
  } else if (midM === 0) {
    runs = [{ kind: DELETE, count: midN }];
  } else {
    runs = editRuns(ai.subarray(prefix, prefix + midN), bi.subarray(prefix, prefix + midM), midN, midM);
  }
  if (prefix > 0) runs.unshift({ kind: KEEP, count: prefix });
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  // One patch line, pushed as pieces the final join concatenates, so no
  // per-line string is ever built: a line that ends its text with no
  // newline is written with one and followed by a line "%".
  const put = (op, line) => {
    out.push(op, line);
    if (line.charCodeAt(line.length - 1) !== 10) out.push('\n%\n');
  };
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) put('=', a[at]);
      for (let i = 0; i < c.dels; i++) put('-', a[c.o + i]);
      for (let i = 0; i < c.ins; i++) put('+', b[c.p + i]);
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) put('=', a[at]);
  }
  return out.join('');
}
