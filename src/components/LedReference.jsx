import { useState } from 'react';
import { Icon } from './ui.jsx';
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

// Online docs worth having one tap away in the pit. These need a signal, unlike the LED
// tables below.
const DOC_LINKS = [
  ['WPILib docs', 'https://docs.wpilib.org/en/stable/', 'Control system, Driver Station, imaging, programming'],
  ['WPILib status light reference', 'https://docs.wpilib.org/en/stable/docs/hardware/hardware-basics/status-lights-ref.html', 'Every official status-light table in one page'],
  ['CTRE Phoenix 6 docs', 'https://v6.docs.ctr-electronics.com/en/stable/', 'Talon FX, CANcoder, Pigeon 2, Tuner X'],
  ['CTRE Phoenix 5 docs', 'https://v5.docs.ctr-electronics.com/en/stable/', 'Talon SRX, Victor SPX, PDP, PCM'],
  ['REVLib docs', 'https://docs.revrobotics.com/revlib', 'SPARK MAX / SPARK Flex programming'],
  ['REV hardware docs', 'https://docs.revrobotics.com/', 'SPARK, PDH, Pneumatic Hub, REV Hardware Client'],
  ['FRC radio docs', 'https://frc-radio.vivid-hosting.net/', 'VH-109 radio setup and status lights'],
];

function DocLinks() {
  return (
    <section className="section">
      <div className="section-head"><h2>Documentation</h2></div>
      <ul className="row-list sheet">
        {DOC_LINKS.map(([label, href, sub]) => (
          <li key={href}>
            <a className="row doc-link" href={href} target="_blank" rel="noreferrer">
              <div className="row-main">
                <div className="row-title">{label}</div>
                <div className="row-sub">{sub}</div>
              </div>
              <Icon name="external" size={18} />
            </a>
          </li>
        ))}
      </ul>
      <p className="hint">Opens in the browser and needs a connection.</p>
    </section>
  );
}

/** Offline lookup for radio/CTRE/REV status-LED blink codes, for diagnosing hardware in the pit
 *  without needing a signal to search for it. Each device is a collapsible box (all open by
 *  default). A search opens every device that has a match, and those can still be collapsed
 *  individually; that search-time state is separate and resets with each new search, so
 *  clearing the box brings back whatever was open before. Online doc links sit at the bottom. */
export default function LedReference() {
  const [q, setQ] = useState('');
  // Tracks collapsed devices rather than open ones, so everything starts expanded.
  const [closed, setClosed] = useState(() => new Set());
  const [searchClosed, setSearchClosed] = useState(() => new Set());
  const query = q.trim().toLowerCase();

  const devices = LED_REFERENCE.map((d) => ({
    ...d,
    rows: query
      ? d.rows.filter((r) => `${d.device} ${r.pattern} ${r.meaning}`.toLowerCase().includes(query))
      : d.rows,
  })).filter((d) => d.rows.length > 0);

  const byBrand = {};
  for (const d of devices) (byBrand[d.brand] ??= []).push(d);

  const collapsed = query ? searchClosed : closed;
  const setCollapsed = query ? setSearchClosed : setClosed;
  const toggle = (device) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(device)) next.delete(device);
      else next.add(device);
      return next;
    });
  const allOpen = devices.every((d) => !collapsed.has(d.device));

  return (
    <>
      <div className="section-head"><h2>Status lights</h2>
        {devices.length > 0 && (
          <button className="chip" onClick={() => setCollapsed(allOpen ? new Set(devices.map((d) => d.device)) : new Set())}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      <input className="input" style={{ marginBottom: 12 }}
        placeholder="Search by device, color, or fault (e.g. “orange”)"
        value={q} onChange={(e) => {
          setQ(e.target.value);
          setSearchClosed(new Set());
        }} aria-label="Search LED reference" />
      {Object.keys(byBrand).length === 0 ? (
        <p className="muted">No matches. Try a different color, blink pattern, or device name.</p>
      ) : (
        Object.entries(byBrand).map(([brand, brandDevices]) => (
          <section className="section" key={brand}>
            <h3 className="brand-head">{brand}</h3>
            {brandDevices.map((d) => {
              const isOpen = !collapsed.has(d.device);
              return (
                <div key={d.device} className="led-device sheet">
                  <button className="led-device-head" aria-expanded={isOpen} onClick={() => toggle(d.device)}>
                    <span style={{ flex: 1 }}>{d.device}</span>
                    <span className="small muted">{d.rows.length}</span>
                    <span className="led-chevron"><Icon name="chevron" size={18} /></span>
                  </button>
                  {isOpen && (
                    <div className="led-device-body">
                      {d.note && <p className="hint" style={{ margin: '0 0 6px' }}>{d.note}</p>}
                      <ul className="led-rows">
                        {d.rows.map((r, i) => (
                          <li key={i}>
                            <div className="led-pattern">
                              <LedSwatch swatch={r.swatch} />
                              {r.pattern}
                            </div>
                            <div className="led-meaning">{r.meaning}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))
      )}
      <p className="hint">
        Compiled from official Vivid-Hosting, CTRE and REV documentation. Firmware adds new states
        over time — check the manufacturer's docs if a light doesn't match anything here.
      </p>
      <DocLinks />
    </>
  );
}
