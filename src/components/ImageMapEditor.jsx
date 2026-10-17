import { useMemo, useRef, useState } from 'react';
import { db } from '../lib/db.js';
import { useTeamLabels } from '../lib/teamLabels.js';
import { toast } from '../lib/util.js';
import { Icon, Modal } from './ui.jsx';

/**
 * Make (or fix) a pit map from an image: pick a photo/screenshot of the event's pit map, OCR
 * finds the teams' numbers on it, then the user reviews — remove wrong pins, tap to place
 * teams OCR missed, tap a pin then a new spot to move it — and saves. Saved on the event as
 * `imageMap: { dataUrl, width, height, pins: [{ team, x, y, w, h }] }` (pins are centers in
 * image pixels).
 */
export default function ImageMapEditor({ event, onClose }) {
  const labels = useTeamLabels();
  const existing = event.imageMap ?? null;
  const [image, setImage] = useState(existing ? { dataUrl: existing.dataUrl, width: existing.width, height: existing.height } : null);
  const [pins, setPins] = useState(existing?.pins ?? []);
  const [stage, setStage] = useState(existing ? 'review' : 'pick');
  const [progress, setProgress] = useState({ value: 0, text: '' });
  const [selected, setSelected] = useState(null); // team number of the pin being moved/removed
  const [placing, setPlacing] = useState(null); // team number waiting for a tap to place
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const loaded = useRef(null); // HTMLImageElement of a newly picked file, for re-reading

  const roster = useMemo(() => [...event.teams].sort((a, b) => a.number - b.number), [event.teams]);
  const placed = new Set(pins.map((p) => p.team));
  const missing = roster.filter((t) => !placed.has(t.number));
  const typical = useMemo(() => {
    const ws = pins.map((p) => p.w).sort((a, b) => a - b);
    const hs = pins.map((p) => p.h).sort((a, b) => a - b);
    const mid = (a, d) => (a.length ? a[Math.floor(a.length / 2)] : d);
    return { w: mid(ws, (image?.width ?? 1000) * 0.03), h: mid(hs, (image?.width ?? 1000) * 0.018) };
  }, [pins, image]);

  async function runOcr(img, size) {
    setStage('reading');
    setError('');
    try {
      const { findTeamsInImage } = await import('../lib/pitOcr.js');
      const teams = roster.map((t) => ({ number: t.number, labels: [...new Set([String(t.number), labels.num(t.number)])] }));
      const { pins: found } = await findTeamsInImage(img, size, teams, (value, text) => setProgress({ value, text }));
      setPins(found);
      setStage('review');
      toast(`Found ${found.length} of ${roster.length} teams`);
    } catch (e) {
      setError(`Couldn't read the image: ${e.message}`);
      setStage(image ? 'review' : 'pick');
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { fileToImage, storedImage } = await import('../lib/pitOcr.js');
      const { img, url } = await fileToImage(file);
      const stored = storedImage(img);
      loaded.current = img;
      setImage(stored);
      setSelected(null);
      setPlacing(null);
      await runOcr(img, stored);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function rereadSaved() {
    // Re-run OCR on the saved image (e.g. after the roster changed).
    const img = new Image();
    img.src = image.dataUrl;
    await img.decode();
    await runOcr(img, image);
  }

  function tapImage(e) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * image.width;
    const y = ((e.clientY - rect.top) / rect.height) * image.height;
    if (placing) {
      setPins((ps) => [...ps.filter((p) => p.team !== placing), { team: placing, x, y, w: typical.w, h: typical.h }]);
      setPlacing(null);
      return;
    }
    if (selected) {
      setPins((ps) => ps.map((p) => (p.team === selected ? { ...p, x, y } : p)));
      setSelected(null);
    }
  }

  async function save() {
    await db.put('events', {
      ...event,
      imageMap: { dataUrl: image.dataUrl, width: image.width, height: image.height, pins: pins.map(({ conf, ...p }) => p), updatedAt: Date.now() },
    });
    toast('Pit map saved');
    onClose();
  }

  async function removeMap() {
    if (!confirm('Remove the pit map image for this event?')) return;
    const { imageMap, ...rest } = event;
    void imageMap;
    await db.put('events', rest);
    toast('Pit map image removed');
    onClose();
  }

  const hint = placing
    ? `Tap the map where team ${labels.num(placing)}'s pit is.`
    : selected
      ? `Tap a new spot to move ${labels.num(selected)}, or remove it below.`
      : 'Tap a pin to move or remove it. Tap a missing team below, then its spot on the map.';

  return (
    <Modal title="Pit map from an image" onClose={onClose}>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {stage === 'pick' && (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            Take a photo of the posted pit map or pick a screenshot. The app reads the team numbers on it (on this
            phone, nothing is uploaded) and pins each team where its number is. You can fix anything it misses.
          </p>
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            <Icon name="camera" size={20} /> Choose or take a photo
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {stage === 'reading' && (
        <div className="stack" aria-live="polite">
          <p style={{ margin: 0 }}>{progress.text || 'Reading numbers…'}</p>
          <div className="progress"><div style={{ width: `${Math.round(progress.value * 100)}%` }} /></div>
          <p className="hint" style={{ margin: 0 }}>The first time can take a little longer while the reader loads.</p>
        </div>
      )}

      {stage === 'review' && image && (
        <div className="stack">
          <p className="small" style={{ margin: 0 }}>
            <strong>{pins.length} of {roster.length}</strong> teams placed. {hint}
          </p>
          <div className="map-scroll image-map-edit">
            <svg viewBox={`0 0 ${image.width} ${image.height}`} style={{ width: '100%', height: 'auto', display: 'block', cursor: placing || selected ? 'crosshair' : 'default' }}
              onClick={tapImage} role="img" aria-label="Pit map image with team pins">
              <image href={image.dataUrl} x="0" y="0" width={image.width} height={image.height} />
              {pins.map((p) => {
                const on = selected === p.team;
                const w = Math.max(p.w * 1.35, image.width * 0.028);
                const h = Math.max(p.h * 1.5, w * 0.55);
                return (
                  <g key={p.team} onClick={(e) => { e.stopPropagation(); setPlacing(null); setSelected(on ? null : p.team); }}
                    style={{ cursor: 'pointer' }}>
                    <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={h * 0.12}
                      style={{ fill: on ? 'var(--st-watch)' : 'var(--accent)', fillOpacity: 0.8, stroke: '#fff', strokeWidth: Math.max(1.5, w * 0.03) }} />
                    <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                      style={{ fill: on ? '#16212c' : '#fff', fontWeight: 700, fontSize: h * 0.62 }}>
                      {labels.num(p.team)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          {selected && (
            <div className="inline">
              <button className="btn danger" style={{ minHeight: 36 }}
                onClick={() => { setPins((ps) => ps.filter((p) => p.team !== selected)); setSelected(null); }}>
                Remove {labels.num(selected)}
              </button>
              <button className="btn" style={{ minHeight: 36 }} onClick={() => setSelected(null)}>Done</button>
            </div>
          )}
          {missing.length > 0 && (
            <div className="field">
              <span>Not found ({missing.length}) — tap one, then its spot</span>
              <div className="inline" style={{ gap: 6 }}>
                {missing.map((t) => (
                  <button key={t.number} className="chip" aria-pressed={placing === t.number}
                    onClick={() => { setSelected(null); setPlacing(placing === t.number ? null : t.number); }}>
                    {labels.num(t.number)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="inline">
            <button className="btn primary" onClick={save} disabled={!pins.length}>Save pit map</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>Use a different image</button>
            {loaded.current || existing ? <button className="btn" onClick={rereadSaved}>Read numbers again</button> : null}
            {existing && <button className="btn danger" onClick={removeMap}>Remove</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
