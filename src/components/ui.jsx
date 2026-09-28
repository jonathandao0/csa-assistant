import { useEffect, useState } from 'react';
import { PRIORITIES, READINESS_ITEMS, TEAM_COLORS, TICKET_STATUS, formatDateTime, ticketNumber } from '../lib/logic.js';
import { nav } from '../lib/router.js';

const paths = {
  back: 'M15.5 4.5 8 12l7.5 7.5',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7.4-3.2c0-.5 0-1-.1-1.4l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.4-1.4L14 2.6h-4l-.5 2.6c-.9.3-1.7.8-2.4 1.4l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.8l-2 1.6 2 3.4 2.4-1c.7.6 1.5 1.1 2.4 1.4l.5 2.6h4l.5-2.6c.9-.3 1.7-.8 2.4-1.4l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.4Z',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5',
  report: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  flag: 'M6 21V4M6 4h12l-2.5 4L18 12H6',
  copy: 'M9 9h11v11H9zM6 15H4V4h11v2',
};

export function Icon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function TopBar({ title, subtitle, back, actions, children }) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        {back && (
          <button className="icon-btn" aria-label="Back" onClick={back}>
            <Icon name="back" />
          </button>
        )}
        <div className="topbar-title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </header>
  );
}

export function TeamBox({ number, color = 'none', large, onClick }) {
  const c = TEAM_COLORS[color];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`teambox${large ? ' lg' : ''}`}
      style={{ background: c.fill, color: c.text, border: 0 }}
      onClick={onClick}
      title={c.label}
    >
      {number}
    </Tag>
  );
}

export function ReadinessMarks({ readiness }) {
  return (
    <div className="marks" aria-label="Readiness">
      {READINESS_ITEMS.map(([k, full, short]) => (
        <span key={k} className={`mark${readiness?.[k] ? ' done' : ''}`} title={full}>
          {readiness?.[k] ? '✓ ' : ''}
          {short}
        </span>
      ))}
    </div>
  );
}

export function StatusPill({ status }) {
  return <span className={`pill ${status}`}>{TICKET_STATUS[status]?.short}</span>;
}

const prioLabel = Object.fromEntries(PRIORITIES);

export function TicketRow({ ticket, showTeam = true, showEvent = false }) {
  return (
    <li>
      <button className="row" onClick={() => nav(`/event/${ticket.eventKey}/ticket/${ticket.id}`)}>
        {showTeam && <span className="num" style={{ fontSize: '1.2rem', minWidth: 48 }}>{ticket.team}</span>}
        <div className="row-main">
          <div className="row-title">{ticket.title}</div>
          <div className="row-sub">
            {ticketNumber(ticket)} · {showEvent ? `${ticket.eventName || ticket.eventKey} · ` : ''}
            {formatDateTime(ticket.createdAt)}
            {ticket.lastMatch ? ` · after ${ticket.lastMatch}` : ''}
            {ticket.links?.length ? ` · ${ticket.links.length} linked` : ''}
          </div>
          {ticket.tags?.length > 0 && (
            <div className="inline" style={{ gap: 4, marginTop: 4 }}>
              {ticket.tags.map((t) => (
                <span className="tag" key={t}>{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
          <StatusPill status={ticket.status} />
          <span className={`prio ${ticket.priority}`}>{prioLabel[ticket.priority]}</span>
        </div>
      </button>
    </li>
  );
}

export function Legend({ phase }) {
  const keys = phase === 'event'
    ? ['ready', 'partial', 'none', 'watch', 'ignored']
    : ['ready', 'partial', 'none', 'ignored'];
  return (
    <div className="legend">
      {keys.map((k) => (
        <span key={k}>
          <i style={{ background: TEAM_COLORS[k].fill }} />
          {TEAM_COLORS[k].label}
        </span>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toaster() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let timer;
    const show = (e) => {
      setMsg(e.detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 3200);
    };
    window.addEventListener('csa-toast', show);
    return () => window.removeEventListener('csa-toast', show);
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export function Loading() {
  return <div className="page muted">Loading…</div>;
}
