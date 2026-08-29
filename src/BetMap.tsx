import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, GitPullRequest, Map as MapIcon } from 'lucide-react';
import { mappablePitches, renderMarkdownMap, renderMermaidMap } from '../shared/exports';
import {
  APPETITE_BAND_LABELS,
  appetiteBandOf,
  confidenceOf,
  DEFAULT_HORIZONS,
  horizonOf,
  ladderStage,
  resolvableDependencies,
  type Horizon,
  type Pitch,
} from '../shared/pitch';

interface EdgeLine {
  key: string;
  d: string;
  fromTitle: string;
  toTitle: string;
  reason: string;
  labelX: number;
  labelY: number;
}

function title(pitch: Pitch): string {
  return pitch.title.trim() || 'Untitled note';
}

function downloadFile(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function BetMap({ pitches, horizons = DEFAULT_HORIZONS, onOpen }: { pitches: Pitch[]; horizons?: Horizon[]; onOpen: (id: string) => void }) {
  const mapped = useMemo(() => mappablePitches(pitches), [pitches]);
  const byId = useMemo(() => new Map(mapped.map((pitch) => [pitch.id, pitch])), [mapped]);
  const edges = useMemo(
    () => mapped.flatMap((pitch) => resolvableDependencies(pitch, mapped).map((edge) => ({ from: edge.pitchId, to: pitch.id, reason: edge.reason.trim() }))),
    [mapped],
  );

  const boardRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<EdgeLine[]>([]);
  const [board, setBoard] = useState({ width: 0, height: 0 });
  const [activeEdge, setActiveEdge] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useLayoutEffect(() => {
    function recompute() {
      const element = boardRef.current;
      if (!element) return;
      const base = element.getBoundingClientRect();
      setBoard({ width: Math.round(base.width), height: Math.round(base.height) });
      const next: EdgeLine[] = [];
      for (const edge of edges) {
        const fromEl = cardRefs.current.get(edge.from);
        const toEl = cardRefs.current.get(edge.to);
        if (!fromEl || !toEl) continue;
        const a = fromEl.getBoundingClientRect();
        const b = toEl.getBoundingClientRect();
        const box = (rect: DOMRect) => ({ left: rect.left - base.left, right: rect.right - base.left, top: rect.top - base.top, bottom: rect.bottom - base.top, midX: rect.left - base.left + rect.width / 2, midY: rect.top - base.top + rect.height / 2 });
        const from = box(a);
        const to = box(b);
        let d: string;
        if (to.left >= from.right - 1) {
          d = `M ${from.right} ${from.midY} C ${from.right + 42} ${from.midY}, ${to.left - 42} ${to.midY}, ${to.left - 5} ${to.midY}`;
        } else if (from.left >= to.right - 1) {
          d = `M ${from.left} ${from.midY} C ${from.left - 42} ${from.midY}, ${to.right + 42} ${to.midY}, ${to.right + 5} ${to.midY}`;
        } else if (to.top >= from.bottom - 1) {
          d = `M ${from.midX} ${from.bottom} C ${from.midX} ${from.bottom + 34}, ${to.midX} ${to.top - 34}, ${to.midX} ${to.top - 5}`;
        } else {
          d = `M ${from.midX} ${from.top} C ${from.midX} ${from.top - 34}, ${to.midX} ${to.bottom + 34}, ${to.midX} ${to.bottom + 5}`;
        }
        next.push({
          key: `${edge.from}->${edge.to}`,
          d,
          fromTitle: title(byId.get(edge.from) as Pitch),
          toTitle: title(byId.get(edge.to) as Pitch),
          reason: edge.reason,
          labelX: Math.round((from.midX + to.midX) / 2),
          labelY: Math.round((from.midY + to.midY) / 2),
        });
      }
      setLines(next);
    }
    recompute();
    const observer = new ResizeObserver(recompute);
    if (boardRef.current) observer.observe(boardRef.current);
    window.addEventListener('resize', recompute);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [edges, byId]);

  async function copyExport(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${label} copied to the clipboard.`);
    } catch {
      setStatus('Copy failed — this browser blocked clipboard access. Use download instead.');
    }
  }

  const active = lines.find((line) => line.key === activeEdge) ?? null;

  return <section className="page betmap-page">
    <div className="page-heading betmap-heading">
      <div>
        <span className="kicker">Bet map</span>
        <h1>Where the bets point.</h1>
        <p>Bets and proposals grouped by horizon. Horizons describe intent—now, next, later—never committed dates. Arrows show what unblocks what; hover or tap an arrow for the reason.</p>
      </div>
      {mapped.length > 0 && <div className="betmap-exports" role="group" aria-label="Portable exports">
        <span>Mermaid</span>
        <button className="secondary" onClick={() => copyExport(renderMermaidMap(pitches, horizons), 'Mermaid map')}><Copy size={14} /> Copy</button>
        <button className="secondary" onClick={() => downloadFile(renderMermaidMap(pitches, horizons), 'bet-map.mmd', 'text/plain')}><Download size={14} /> Download</button>
        <span>Markdown</span>
        <button className="secondary" onClick={() => copyExport(renderMarkdownMap(pitches, horizons), 'Markdown map')}><Copy size={14} /> Copy</button>
        <button className="secondary" onClick={() => downloadFile(renderMarkdownMap(pitches, horizons), 'bet-map.md', 'text/markdown')}><Download size={14} /> Download</button>
      </div>}
    </div>

    {status && <div className="betmap-status" role="status">{status}</div>}

    {mapped.length === 0 ? (
      <div className="betmap-empty">
        <div className="empty-orbit"><MapIcon size={30} /></div>
        <h2>The map fills as bets are made.</h2>
        <p>Notes stay in the inbox. Shape a note into a proposal and it appears here; make a bet and it takes the foreground. Placement, appetite, confidence, and dependencies live on each pitch’s Decide page.</p>
      </div>
    ) : (
      <div className="betmap-scroll">
        <div className="betmap-board" ref={boardRef}>
          <div className="betmap-columns" style={{ ['--betmap-cols' as string]: horizons.length }}>
            {horizons.map((horizon) => {
              const members = mapped.filter((pitch) => horizonOf(pitch, horizons) === horizon.id);
              return <div className="betmap-column" key={horizon.id}>
                <div className="betmap-column-head"><strong>{horizon.label}</strong><small>{horizon.hint}</small></div>
                {members.length === 0 && <div className="betmap-column-empty">Nothing here yet.</div>}
                {members.map((pitch) => {
                  const stage = ladderStage(pitch);
                  const band = appetiteBandOf(pitch);
                  const confidence = confidenceOf(pitch);
                  const dependencies = resolvableDependencies(pitch, mapped);
                  return <button
                    key={pitch.id}
                    className={`betmap-card ${stage === 'bet' ? 'bet' : 'proposal'}`}
                    ref={(el) => { if (el) cardRefs.current.set(pitch.id, el); else cardRefs.current.delete(pitch.id); }}
                    onClick={() => onOpen(pitch.id)}
                  >
                    <span className="betmap-card-top">
                      <span className={`betmap-stage ${stage}`}>{pitch.github ? <><GitPullRequest size={11} /> Bet · #{pitch.github.number}</> : stage === 'bet' ? 'Bet' : 'Proposal'}</span>
                      {confidence && <span className={`betmap-confidence ${confidence}`}>{confidence} confidence</span>}
                    </span>
                    <strong>{title(pitch)}</strong>
                    <small className="betmap-appetite">{band ? APPETITE_BAND_LABELS[band] : 'Appetite band unset'}{pitch.appetite.trim() ? ` · ${pitch.appetite.trim()}` : ''}</small>
                    {dependencies.length > 0 && <span className="betmap-deps">
                      {dependencies.map((edge) => <small key={edge.pitchId}>↳ needs {title(byId.get(edge.pitchId) as Pitch)}{edge.reason.trim() ? ` — ${edge.reason.trim()}` : ''}</small>)}
                    </span>}
                  </button>;
                })}
              </div>;
            })}
          </div>
          <svg className="betmap-edges" aria-hidden="true" width={board.width} height={board.height} viewBox={`0 0 ${board.width} ${board.height}`}>
            <defs>
              <marker id="betmap-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#596340" />
              </marker>
            </defs>
            {lines.map((line) => <g key={line.key}>
              <path className="betmap-edge-hit" d={line.d} onClick={() => setActiveEdge(activeEdge === line.key ? null : line.key)} />
              <path className={`betmap-edge ${activeEdge === line.key ? 'active' : ''}`} d={line.d} markerEnd="url(#betmap-arrow)">
                <title>{`${line.fromTitle} unblocks ${line.toTitle}${line.reason ? `: ${line.reason}` : ''}`}</title>
              </path>
            </g>)}
          </svg>
        </div>
      </div>
    )}

    {active && <div className="betmap-edge-note" role="note">
      <strong>{active.fromTitle} → {active.toTitle}</strong>
      <span>{active.reason || 'No reason recorded for this dependency.'}</span>
    </div>}
  </section>;
}
