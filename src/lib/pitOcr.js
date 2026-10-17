// Pit map from an image: reads team numbers off a photo/screenshot of the pit map with
// Tesseract.js OCR, entirely on the device. The engine, worker and English model are served
// from this site under tesseract/ (see vite.config.js), so nothing is sent anywhere and it
// works offline once used. This module is only loaded when someone actually uses it.

/** Where the OCR assets live, resolved against the page (works at a GitHub Pages sub-path). */
const assetBase = () => new URL('tesseract/', document.baseURI).href;

/** Loads an image file. Returns { img, url }; revoke `url` when done. */
export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

function drawScaled(img, maxSide, filter) {
  const scale = Math.min(maxSide / Math.max(img.width, img.height), 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (filter) ctx.filter = filter;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

/** The image to keep with the event: JPEG, longest side 2000 px (enough to read pit labels
 *  when zoomed, small enough to sync). Returns { dataUrl, width, height }. */
export function storedImage(img) {
  const { canvas } = drawScaled(img, Math.min(2000, Math.max(img.width, img.height)));
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
}

/** Edit distance, capped: returns > max as soon as it's exceeded (team numbers are short). */
function distance(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

/** Matches an OCR token to a team: exactly, or — for 4+ character tokens — one character
 *  off from exactly one team's label ("929111" → 99111), at reduced confidence. */
function matchToken(text, byText) {
  const t = text.replace(/^FRC/, '');
  if (byText.has(t)) return { team: byText.get(t), penalty: 0 };
  if (t.length < 4) return null;
  let hit = null;
  for (const [label, team] of byText) {
    if (label.length < 4 || distance(t, label) > 1) continue;
    if (hit && hit !== team) return null; // ambiguous
    hit = team;
  }
  return hit ? { team: hit, penalty: 25 } : null;
}

/**
 * Finds the event's teams in a pit map image.
 *
 * OCR on a whole pit map tends to skip regions and misread a digit here and there, so this
 * runs up to three passes — sparse text over the whole image, automatic layout over the whole
 * image, then the image in four overlapping quarters — stopping once every team is found, and
 * keeps the most confident reading of each team. Near-misses one character off a team number
 * are accepted when unambiguous.
 *
 * @param img       loaded HTMLImageElement
 * @param size      { width, height } of the stored image; pins are returned in its pixels
 * @param teams     [{ number, labels: ['254', '971B', ...] }] — every text a team may appear as
 * @param onProgress (fraction 0–1, status text)
 * @returns { pins: [{ team, x, y, w, h, conf }], words } — x/y are pin centers
 */
export async function findTeamsInImage(img, size, teams, onProgress = () => {}) {
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  const base = assetBase();
  let stage = { from: 0, span: 0.15, label: 'Loading the text reader…' };
  onProgress(0, stage.label);
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    gzip: true,
    logger: (m) => {
      if (typeof m.progress === 'number') onProgress(stage.from + m.progress * stage.span, stage.label);
    },
  });

  const byText = new Map();
  for (const t of teams) for (const label of t.labels) byText.set(String(label).toUpperCase(), t.number);
  const best = new Map();
  const allWords = [];

  // Larger, grayscale, high-contrast input reads small printed numbers far better.
  const { canvas: full } = drawScaled(img, 3000, 'grayscale(1) contrast(1.6)');
  const toStored = size.width / full.width;

  async function pass(region, psm, label, from, span) {
    stage = { from, span, label };
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      // Only characters team numbers use (digits, plus letters for B robots like 971B).
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    });
    const opts = region ? { rectangle: region } : {};
    const { data } = await worker.recognize(full, opts, { blocks: true });
    const words = data.words ?? (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    for (const w of words) {
      const text = String(w.text).trim().toUpperCase();
      if (!text) continue;
      allWords.push({ text, conf: w.confidence, bbox: w.bbox });
      const m = matchToken(text, byText);
      if (!m) continue;
      const { x0, y0, x1, y1 } = w.bbox;
      const pin = {
        team: m.team,
        x: ((x0 + x1) / 2) * toStored,
        y: ((y0 + y1) / 2) * toStored,
        w: Math.max(8, (x1 - x0) * toStored),
        h: Math.max(8, (y1 - y0) * toStored),
        conf: Math.max(0, Math.round(w.confidence) - m.penalty),
      };
      const prev = best.get(m.team);
      if (!prev || pin.conf > prev.conf) best.set(m.team, pin);
    }
  }

  try {
    const allFound = () => best.size >= teams.length;
    await pass(null, PSM.SPARSE_TEXT, 'Reading numbers…', 0.15, 0.3);
    if (!allFound()) await pass(null, PSM.AUTO, 'Looking for missed numbers…', 0.45, 0.25);
    if (!allFound()) {
      // Overlapping quarters, so nothing falls on a seam.
      const W = full.width;
      const H = full.height;
      const ow = Math.round(W * 0.58);
      const oh = Math.round(H * 0.58);
      const quarters = [[0, 0], [W - ow, 0], [0, H - oh], [W - ow, H - oh]];
      for (let i = 0; i < quarters.length && !allFound(); i++) {
        const [left, top] = quarters[i];
        await pass({ left, top, width: ow, height: oh }, PSM.SPARSE_TEXT, 'Checking each part of the map…', 0.7 + i * 0.075, 0.075);
      }
    }
    onProgress(1, 'Done');
    return { pins: [...best.values()], words: allWords };
  } finally {
    await worker.terminate();
  }
}

/** One size for every pit on an image map, so the diagram reads evenly however big each
 *  printed number happened to be. Square pits sized from the spacing between neighbouring
 *  pins (a low quantile, so a couple of crowded pins don't shrink everything and boxes don't
 *  overlap) and capped at about twice the printed number, falling back to the typical OCR'd number width when there's only one pin. */
export function uniformPitSize(pins, imageWidth) {
  const floor = imageWidth * 0.02;
  if (!pins?.length) return imageWidth * 0.04;
  const sorted = (a) => [...a].sort((x, y) => x - y);
  const typicalNumber = sorted(pins.map((p) => p.w ?? 0))[Math.floor(pins.length / 2)] * 1.35;
  if (pins.length < 2) return Math.max(floor, typicalNumber);
  const nearest = pins.map((p) =>
    Math.min(...pins.filter((q) => q !== p).map((q) => Math.hypot(q.x - p.x, q.y - p.y))));
  const spacing = sorted(nearest)[Math.floor((nearest.length - 1) * 0.25)];
  // Capped for spread-out maps, so far-apart pins don't get giant boxes.
  return Math.max(floor, Math.min(spacing * 0.9, typicalNumber * 2.2));
}

const quantile = (values, q) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) * q)] : null;
};

/** Groups 1-D values: a gap bigger than `tol` between neighbours starts a new group.
 *  Returns [{ center, members: [index...] }] in ascending order. */
function cluster(values, tol) {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const groups = [];
  for (const i of order) {
    const g = groups[groups.length - 1];
    if (g && values[i] - values[g.members[g.members.length - 1]] <= tol) g.members.push(i);
    else groups.push({ members: [i] });
  }
  for (const g of groups) g.center = g.members.reduce((t, i) => t + values[i], 0) / g.members.length;
  return groups;
}

/** Spacing between pins in the same row (or column): the typical gap between neighbours. */
function pitchWithin(groups, values) {
  const gaps = [];
  for (const g of groups) {
    const v = g.members.map((i) => values[i]).sort((a, b) => a - b);
    for (let k = 1; k < v.length; k++) gaps.push(v[k] - v[k - 1]);
  }
  return quantile(gaps, 0.25);
}

/** Grid index for each group: neighbours about one pitch apart sit next to each other
 *  (back-to-back pits); a bigger gap leaves empty cells between them — a hallway. */
function gridIndex(groups, pitch) {
  const idx = [];
  groups.forEach((g, k) => {
    if (!k) return idx.push(0);
    const steps = Math.max(1, Math.round((g.center - groups[k - 1].center) / pitch));
    idx.push(idx[k - 1] + steps);
  });
  return idx;
}

/** Cells between consecutive used indexes, as [first, last] runs: hallways. */
function emptyRuns(used) {
  const runs = [];
  for (let k = 1; k < used.length; k++) if (used[k] - used[k - 1] > 1) runs.push([used[k - 1] + 1, used[k] - 1]);
  return runs;
}

export const GRID_CELL = 100;

/**
 * Builds the pit map PitMap renders from a saved image map, as a grid diagram (no photo):
 * 1. OCR gave each team's number and where it is on the image (`pins`).
 * 2. Pins are grouped into rows (by y) and columns (by x). The spacing between neighbouring
 *    pins in a row/column is one pit; rows or columns further apart than that get empty grid
 *    cells between them, drawn as hallways.
 * 3. Each team gets one same-size square cell at its row/column.
 * Pure: recomputed from the pins whenever they change, so the editor stays the source.
 */
export function imageMapToPitMap(imageMap) {
  const pins = imageMap.pins ?? [];
  const empty = { size: { x: GRID_CELL, y: GRID_CELL }, pits: {}, areas: {}, labels: {}, arrows: {}, walls: {}, aisles: [] };
  if (!pins.length) return empty;
  const xs = pins.map((p) => p.x);
  const ys = pins.map((p) => p.y);
  // Pins closer than about half a pit are in the same row/column.
  const nn = uniformPitSize(pins, imageMap.width) / 0.9;
  const tol = Math.max(4, nn * 0.5);
  const rows = cluster(ys, tol);
  const cols = cluster(xs, tol);
  let dx = pitchWithin(rows, xs);
  let dy = pitchWithin(cols, ys);
  dx ??= dy ?? nn;
  dy ??= dx;
  // A layout with every row separated by a hallway has no back-to-back rows to measure, so
  // never treat the row pitch as more than ~1.6 pits (assume roughly square pits).
  dy = Math.min(dy, dx * 1.6);
  dx = Math.min(dx, dy * 1.6);
  const rowIdx = gridIndex(rows, dy);
  const colIdx = gridIndex(cols, dx);
  const rowOf = new Map();
  const colOf = new Map();
  rows.forEach((g, k) => g.members.forEach((i) => rowOf.set(i, rowIdx[k])));
  cols.forEach((g, k) => g.members.forEach((i) => colOf.set(i, colIdx[k])));

  const nRows = rowIdx[rowIdx.length - 1] + 1;
  const nCols = colIdx[colIdx.length - 1] + 1;
  const margin = GRID_CELL * 0.5;
  const at = (c) => margin + c * GRID_CELL + GRID_CELL / 2;
  const pits = {};
  const taken = new Set();
  pins.forEach((p, i) => {
    let r = rowOf.get(i);
    let c = colOf.get(i);
    // Two teams snapped to one cell (crowded or skewed photo): use the next free cell in the row.
    while (taken.has(`${r}:${c}`)) c += 1;
    taken.add(`${r}:${c}`);
    pits[`img-${p.team}`] = { position: { x: at(c), y: at(r) }, size: { x: GRID_CELL, y: GRID_CELL }, team: String(p.team) };
  });
  const width = margin * 2 + Math.max(nCols, ...[...taken].map((k) => Number(k.split(':')[1]) + 1)) * GRID_CELL;
  const height = margin * 2 + nRows * GRID_CELL;
  // Hallways: whole empty rows/columns between used ones, drawn as light bands.
  const aisles = [
    ...emptyRuns([...new Set(rowIdx)]).map(([a, b]) => ({
      position: { x: width / 2, y: margin + ((a + b + 1) / 2) * GRID_CELL },
      size: { x: width - margin, y: (b - a + 1) * GRID_CELL - GRID_CELL * 0.2 },
    })),
    ...emptyRuns([...new Set(colIdx)]).map(([a, b]) => ({
      position: { x: margin + ((a + b + 1) / 2) * GRID_CELL, y: height / 2 },
      size: { x: (b - a + 1) * GRID_CELL - GRID_CELL * 0.2, y: height - margin },
    })),
  ];
  return { ...empty, size: { x: width, y: height }, pits, aisles };
}
