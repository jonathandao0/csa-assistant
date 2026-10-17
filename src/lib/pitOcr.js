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

/** Builds the Nexus-shaped map JSON PitMap renders, from a saved image map. Each pin becomes
 *  a pit box a bit larger than the number OCR found (so it's easy to tap and covers the
 *  printed number), keyed by team. */
export function imageMapToPitMap(imageMap) {
  const pits = {};
  for (const p of imageMap.pins ?? []) {
    const w = Math.max(p.w * 1.35, imageMap.width * 0.028);
    const h = Math.max(p.h * 1.5, w * 0.55);
    pits[`img-${p.team}`] = { position: { x: p.x, y: p.y }, size: { x: w, y: h }, team: String(p.team) };
  }
  return { size: { x: imageMap.width, y: imageMap.height }, pits, areas: {}, labels: {}, arrows: {}, walls: {} };
}
