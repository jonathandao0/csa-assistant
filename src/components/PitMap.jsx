import { useMemo, useState } from 'react';
import { TEAM_COLORS } from '../lib/logic.js';

// Nexus map items give a center position and a size, plus an optional angle in degrees.
function box(item) {
  const { x, y } = item.position;
  const w = item.size?.x ?? 100;
  const h = item.size?.y ?? 100;
  return { x, y, w, h, angle: item.angle ?? 0 };
}
const rot = (b) => (b.angle ? `rotate(${b.angle} ${b.x} ${b.y})` : undefined);

function Arrow({ item }) {
  const b = box(item);
  const { x, y, w, h } = b;
  const head = Math.min(w, h * 0.45);
  const shaft = w * 0.35;
  const top = y - h / 2;
  const bottom = y + h / 2;
  const double = item.type === 'double';
  const pts = [
    [x, top],
    [x + w / 2, top + head],
    [x + shaft / 2, top + head],
    ...(double
      ? [
          [x + shaft / 2, bottom - head],
          [x + w / 2, bottom - head],
          [x, bottom],
          [x - w / 2, bottom - head],
          [x - shaft / 2, bottom - head],
        ]
      : [
          [x + shaft / 2, bottom],
          [x - shaft / 2, bottom],
        ]),
    [x - shaft / 2, top + head],
    [x - w / 2, top + head],
  ];
  return (
    <polygon points={pts.map((p) => p.join(',')).join(' ')} transform={rot(b)}
      style={{ fill: 'var(--muted)', opacity: 0.55 }} />
  );
}

export default function PitMap({ map, colorFor, onSelect, highlight, teamAddresses }) {
  const [zoom, setZoom] = useState(1);
  const W = map.size?.x ?? 1000;
  const H = map.size?.y ?? 1000;

  const pits = useMemo(() => Object.entries(map.pits ?? {}), [map]);
  // Nexus's map JSON doesn't always embed the team on each pit item, so fall back to the
  // team -> pit address lookup from the separate /pits endpoint. Addresses are normalized
  // (trimmed/uppercased) in case the two endpoints don't format them identically.
  const teamByAddress = useMemo(() => {
    const out = {};
    for (const [team, address] of Object.entries(teamAddresses ?? {})) {
      out[String(address).trim().toUpperCase()] = Number(team);
    }
    return out;
  }, [teamAddresses]);

  return (
    <div>
      <div className="map-tools">
        <button className="btn" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.4))}>−</button>
        <button className="btn" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(5, z * 1.4))}>+</button>
        <button className="btn" onClick={() => setZoom(1)} disabled={zoom === 1}>Fit</button>
        <span className="muted small" style={{ marginLeft: 'auto' }}>Tap a pit to open the team</span>
      </div>
      <div className="map-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: `${zoom * 100}%`, height: 'auto' }}
          role="img" aria-label="Pit map">
          {Object.values(map.walls ?? {}).map((w, i) => {
            const b = box(w);
            return (
              <rect key={`w${i}`} x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h}
                transform={rot(b)} style={{ fill: 'var(--ink)', opacity: 0.8 }} />
            );
          })}
          {Object.values(map.areas ?? {}).map((a, i) => {
            const b = box(a);
            const fs = Math.max(12, Math.min(b.h * 0.24, (b.w * 1.6) / Math.max(4, (a.label ?? '').length)));
            return (
              <g key={`a${i}`} transform={rot(b)}>
                <rect x={b.x - b.w / 2 + 3} y={b.y - b.h / 2 + 3} width={b.w - 6} height={b.h - 6} rx="6"
                  style={{ fill: 'var(--accent-soft)', stroke: 'var(--accent)', strokeDasharray: '8 6', strokeWidth: 2 }} />
                <text x={b.x} y={b.y} textAnchor="middle" dominantBaseline="central"
                  style={{ fill: 'var(--ink)', fontSize: fs, fontWeight: 600 }}>{a.label}</text>
              </g>
            );
          })}
          {Object.values(map.labels ?? {}).map((l, i) => {
            const b = box(l);
            return (
              <text key={`l${i}`} x={b.x} y={b.y} textAnchor="middle" dominantBaseline="central"
                transform={rot(b)} style={{ fill: 'var(--muted)', fontSize: Math.max(14, b.h * 0.35), fontWeight: 600 }}>
                {l.label}
              </text>
            );
          })}
          {Object.values(map.arrows ?? {}).map((a, i) => (
            <Arrow key={`r${i}`} item={a} />
          ))}
          {pits.map(([address, pit]) => {
            const b = box(pit);
            const team = pit.team ? Number(pit.team) : (teamByAddress[String(address).trim().toUpperCase()] ?? null);
            const color = team ? TEAM_COLORS[colorFor(team)] : null;
            const label = team ? String(team) : address;
            const fs = Math.min(b.h * 0.42, (b.w * 0.88) / (label.length * 0.52));
            const lit = highlight && team === highlight;
            return (
              <g key={address} className={team ? 'pit' : undefined} transform={rot(b)}
                onClick={team ? () => onSelect(team) : undefined}
                role={team ? 'button' : undefined} aria-label={team ? `Team ${team}, pit ${address}` : undefined}
                tabIndex={team ? 0 : undefined}
                onKeyDown={team ? (e) => e.key === 'Enter' && onSelect(team) : undefined}>
                <rect x={b.x - b.w / 2 + 3} y={b.y - b.h / 2 + 3} width={b.w - 6} height={b.h - 6} rx="4"
                  style={{
                    fill: color ? color.fill : 'var(--surface)',
                    stroke: lit ? 'var(--accent)' : color ? 'var(--ink)' : 'var(--st-empty)',
                    strokeWidth: lit ? 10 : color ? 1.5 : 2,
                    strokeDasharray: color ? undefined : '6 5',
                  }} />
                <text x={b.x} y={team ? b.y + b.h * 0.06 : b.y} textAnchor="middle" dominantBaseline="central"
                  style={{ fill: color ? color.text : 'var(--muted)', fontSize: team ? fs : fs * 0.6 }}>
                  {label}
                </text>
                {team && (
                  <text x={b.x - b.w / 2 + 6} y={b.y - b.h / 2 + 6} textAnchor="start" dominantBaseline="hanging"
                    style={{ fill: color.text, opacity: 0.7, fontSize: Math.max(9, b.h * 0.14), fontWeight: 600 }}>
                    {address}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
