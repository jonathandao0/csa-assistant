import { Fragment, useState } from 'react';
import { LED_REFERENCE } from '../lib/ledCodes.js';

const COLOR_HEX = {
  red: '#e5484d',
  orange: '#f5a524',
  yellow: '#f7d038',
  green: '#2e9d46',
  cyan: '#22d3ee',
  blue: '#3b82f6',
  magenta: '#e347c9',
  white: '#f5f5f5',
  gray: '#8a97a3',
};
const DURATION = { slow: 1.6, normal: 0.9, fast: 0.4 };

/** Small animated stand-in for a real status LED: a solid, blinking, or color-alternating
 *  dot (or pair of dots) that mirrors the pattern described in the row next to it. */
function LedSwatch({ swatch }) {
  if (!swatch) return null;
  const { colors = [], mode, leds = 1, phase = 'sync', speed = 'normal' } = swatch;
  const dur = DURATION[speed] ?? DURATION.normal;

  if (mode === 'off') {
    return <span className="led-swatch" aria-hidden="true"><span className="led-dot led-off" /></span>;
  }

  return (
    <span className="led-swatch" aria-hidden="true">
      {Array.from({ length: leds }).map((_, i) => {
        if (mode === 'solid') {
          return <span key={i} className="led-dot" style={{ background: COLOR_HEX[colors[0]] }} />;
        }
        if (mode === 'alt') {
          const a = COLOR_HEX[colors[0]];
          const b = COLOR_HEX[colors[1] ?? colors[0]];
          return (
            <span key={i} className="led-dot led-alt"
              style={{ '--led-a': a, '--led-b': b, background: a, animationDuration: `${dur * 2}s` }} />
          );
        }
        // blink
        const delay = leds === 2 && phase === 'alt' && i === 1 ? dur : 0;
        return (
          <span key={i} className="led-dot led-blink" style={{
            background: COLOR_HEX[colors[0]],
            animationDuration: `${dur * 2}s`,
            animationDelay: `${delay}s`,
          }} />
        );
      })}
    </span>
  );
}

/** Offline lookup for CTRE/REV status-LED blink codes, for diagnosing hardware in the pit
 *  without needing a signal to search for it. */
export default function LedReference() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const devices = LED_REFERENCE.map((d) => ({
    ...d,
    rows: query
      ? d.rows.filter((r) => `${d.device} ${r.pattern} ${r.meaning}`.toLowerCase().includes(query))
      : d.rows,
  })).filter((d) => d.rows.length > 0);

  const byBrand = {};
  for (const d of devices) (byBrand[d.brand] ??= []).push(d);

  return (
    <>
      <input className="input" style={{ marginBottom: 12 }}
        placeholder="Search by device, color, or fault (e.g. “orange”)"
        value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search LED reference" />
      {Object.keys(byBrand).length === 0 ? (
        <p className="muted">No matches. Try a different color, blink pattern, or device name.</p>
      ) : (
        Object.entries(byBrand).map(([brand, brandDevices]) => (
          <section className="section" key={brand}>
            <div className="section-head"><h2>{brand}</h2></div>
            {brandDevices.map((d) => (
              <div key={d.device} style={{ marginBottom: 14 }}>
                <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>{d.device}</div>
                {d.note && <p className="hint" style={{ margin: '0 0 6px' }}>{d.note}</p>}
                <div className="sheet sheet-pad">
                  <dl className="dl led-dl">
                    {d.rows.map((r, i) => (
                      <Fragment key={i}>
                        <dt style={{ color: 'var(--ink)', fontWeight: 600 }}>
                          <LedSwatch swatch={r.swatch} />
                          {r.pattern}
                        </dt>
                        <dd>{r.meaning}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </div>
              </div>
            ))}
          </section>
        ))
      )}
      <p className="hint">
        Compiled from official CTRE and REV documentation. Firmware adds new states over time —
        check the manufacturer's docs if a light doesn't match anything here.
      </p>
    </>
  );
}
