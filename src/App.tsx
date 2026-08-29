import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Feather,
  GitPullRequest,
  Inbox,
  LockKeyhole,
  LogOut,
  Loader2,
  Map as MapIcon,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  APPETITE_BAND_LABELS,
  APPETITE_BANDS,
  canPreviewBet,
  CONFIDENCE_LEVELS,
  createEmptyPitch,
  DEFAULT_HORIZONS,
  dependencyCycleError,
  horizonOf,
  isBetReady,
  LADDER_STAGES,
  ladderStage,
  type GitHubSnapshot,
  type LadderStage,
  type Pitch,
  type PitchSectionKey,
  shapedSectionCount,
} from '../shared/pitch';
import { BetMap } from './BetMap';
import { api, type AppConfig, type IssuePreview, type RepositoryChoice } from './api';
import { stubSparringPartner } from './sparring';
import { dismissStorageNote, isStorageNoteDismissed, loadPitches, savePitches } from './storage';

type View = 'capture' | 'shape' | 'decide' | 'map';

const stageMeta: Record<LadderStage, { label: string; hint: string }> = {
  note: { label: 'Note', hint: 'A name is enough. Saved instantly.' },
  proposal: { label: 'Proposal', hint: 'Shape as much or as little as helps.' },
  bet: { label: 'Bet', hint: 'A complete shape and a deliberate write.' },
};

const fieldMeta: Array<{ key: PitchSectionKey; eyebrow: string; title: string; prompt: string; placeholder: string }> = [
  { key: 'problem', eyebrow: '01 · Problem', title: 'What is worth solving?', prompt: 'Name the struggle, not the feature request.', placeholder: 'People abandon the weekly review because…' },
  { key: 'evidence', eyebrow: '02 · Evidence', title: 'Why believe this is real?', prompt: 'Use observed behaviour, examples, or a durable signal.', placeholder: 'Three recent examples, quotes, or data points…' },
  { key: 'appetite', eyebrow: '03 · Appetite', title: 'How much is this worth?', prompt: 'A time budget and boundary—not an estimate.', placeholder: 'One focused week. Stop if…' },
  { key: 'constraints', eyebrow: '04 · Boundaries', title: 'What will we not do?', prompt: 'Define no-gos that keep the bet small.', placeholder: 'No mobile app, no notifications, no migration…' },
  { key: 'solution', eyebrow: '05 · Solution sketch', title: 'What is the smallest shaped approach?', prompt: 'Describe the key affordances without locking every detail.', placeholder: 'A focused flow that lets someone…' },
  { key: 'risks', eyebrow: '06 · Rabbit holes', title: 'What could sink the bet?', prompt: 'Call out unknowns and tempting scope traps.', placeholder: 'We may discover… Avoid expanding into…' },
  { key: 'decisionRationale', eyebrow: '07 · Decision', title: 'Why bet—or pass?', prompt: 'Make the tradeoff legible to your future self.', placeholder: 'This is worth the appetite because…' },
];

function relativeDate(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function App() {
  const [pitches, setPitches] = useState<Pitch[]>(() => loadPitches());
  const [selectedId, setSelectedId] = useState<string | null>(() => loadPitches()[0]?.id ?? null);
  const [view, setView] = useState<View>(() => {
    const first = loadPitches()[0];
    return first && ladderStage(first) !== 'note' ? 'shape' : 'capture';
  });
  const [config, setConfig] = useState<AppConfig>({ mode: 'demo', csrfToken: '', owner: 'demo-workspace', repo: 'ship-shape-sandbox', auth: { configured: false, signedIn: false } });
  const [repositories, setRepositories] = useState<RepositoryChoice[]>([]);
  const [preview, setPreview] = useState<IssuePreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStorageNote, setShowStorageNote] = useState(() => !isStorageNoteDismissed());
  const previewTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.config().then((next) => {
      setConfig(next);
      if (next.mode === 'github' && next.auth.signedIn) api.repositories().then((result) => setRepositories(result.repositories)).catch(() => undefined);
      const authResult = new URLSearchParams(window.location.search).get('auth');
      if (authResult) {
        setNotice(authResult === 'success' ? 'Signed in with GitHub. Choose the repository that will hold your bets.' : 'GitHub sign-in was not completed.');
        window.history.replaceState({}, '', window.location.pathname);
      }
    }).catch(() => undefined);
  }, []);
  useEffect(() => { savePitches(pitches); }, [pitches]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [view, selectedId]);

  const selected = pitches.find((pitch) => pitch.id === selectedId);
  const ready = selected ? isBetReady(selected) : false;
  const completed = selected ? shapedSectionCount(selected) : 0;

  function update(patch: Partial<Pitch>) {
    if (!selectedId) return;
    setPitches((items) => items.map((item) => item.id === selectedId
      ? { ...item, ...patch, updatedAt: new Date().toISOString() }
      : item));
    setNotice(null);
  }

  function newOpportunity() {
    const pitch = createEmptyPitch();
    setPitches((items) => [pitch, ...items]);
    setSelectedId(pitch.id);
    setView('capture');
    setNotice(null);
    setError(null);
  }

  async function prepareBet() {
    if (!selected || !canPreviewBet(selected)) return;
    setBusy(true); setError(null);
    try {
      const nextPreview = await api.preview(selected);
      setPreview(nextPreview); setReviewed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare the preview.');
    } finally { setBusy(false); }
  }

  async function confirmBet() {
    if (!preview || !reviewed) return;
    setBusy(true); setError(null);
    try {
      const github = await api.confirm(preview.previewId);
      update({ github });
      setPreview(null); setReviewed(false);
      setNotice(config.mode === 'demo' ? `Demo issue #${github.number} created. No GitHub write occurred.` : `GitHub issue #${github.number} ${preview.action === 'create' ? 'created' : 'updated'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The write failed. Your draft is safe.');
    } finally { setBusy(false); }
  }

  async function refreshIssue() {
    if (!selected?.github) return;
    setBusy(true); setError(null);
    try {
      const github = await api.refresh(selected);
      update({ github });
      setNotice(`Canonical issue refreshed ${relativeDate(github.lastSyncedAt)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh the issue.');
    } finally { setBusy(false); }
  }

  async function selectRepository(value: string) {
    const repository = repositories.find((item) => item.fullName === value);
    if (!repository) return;
    setBusy(true); setError(null);
    try {
      await api.selectRepository(repository.owner, repository.repo);
      setConfig(await api.config());
      setNotice(`${repository.fullName} selected for canonical bet issues.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not select that repository.');
    } finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError(null);
    try {
      await api.logout();
      setConfig(await api.config());
      setRepositories([]);
      setNotice('Signed out. Local shaping drafts remain on this device.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    } finally { setBusy(false); }
  }

  const stage = useMemo(() => selected ? (selected.github ? 'Linked bet' : stageMeta[ladderStage(selected)].label) : '', [selected]);

  return (
    <div className={`app-shell ${config.mode === 'demo' ? 'demo-mode' : ''}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setView('capture')} aria-label="Go to opportunity inbox">
          <span className="brand-mark"><Feather size={18} /></span>
          <span>Ship Shape</span>
        </button>
        <div className="topbar-message">Shape the work before the work shapes you.</div>
        <div className={`mode-pill ${config.mode}`}>
          <CircleDot size={14} />
          {config.mode === 'demo' ? 'Demo · no GitHub writes' : config.repository ? config.repository.fullName : config.auth.signedIn ? `@${config.auth.user?.login} · choose repo` : 'GitHub · signed out'}
        </div>
      </header>

      {config.mode === 'demo' && (
        <div className="demo-banner"><Sparkles size={15} /> You’re in a safe sandbox. The complete bet flow is simulated locally.</div>
      )}

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-section">
            <div className="side-heading">
              <span>Opportunity inbox</span>
              <button className="icon-button" onClick={newOpportunity} title="Jot a note"><Plus size={17} /></button>
            </div>
            <button className={`map-link ${view === 'map' ? 'active' : ''}`} onClick={() => setView('map')}>
              <MapIcon size={15} /> Bet map <small>horizons · no dates</small>
            </button>
            <div className="pitch-list">
              {pitches.length === 0 ? (
                <button className="empty-inbox" onClick={newOpportunity}><Inbox size={22} /><span>Jot your first note</span></button>
              ) : pitches.map((pitch) => (
                <button key={pitch.id} className={`pitch-row ${pitch.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(pitch.id); setView(ladderStage(pitch) === 'note' ? 'capture' : 'shape'); }}>
                  <span className="pitch-title">{pitch.title || 'Untitled note'}</span>
                  <span className="pitch-meta">{pitch.github ? `Issue #${pitch.github.number}` : stageMeta[ladderStage(pitch)].label} · {relativeDate(pitch.updatedAt)}</span>
                </button>
              ))}
            </div>
          </div>
          {showStorageNote && (
            <div className="storage-note">
              <p><strong>Drafts live in this browser.</strong> Notes and proposals are saved to this device’s local storage only—nothing syncs, and clearing site data removes them.</p>
              <button className="icon-button" aria-label="Dismiss local storage note" onClick={() => { dismissStorageNote(); setShowStorageNote(false); }}><X size={14} /></button>
            </div>
          )}
          <div className="sidebar-note">
            <ShieldCheck size={16} />
            <p><strong>Not a project board.</strong><br />Local drafts help you decide. GitHub Issues record the bets you make.</p>
          </div>
        </aside>

        <main className="main">
          {view === 'map' ? (
            <BetMap pitches={pitches} onOpen={(id) => { setSelectedId(id); setView('shape'); }} />
          ) : !selected ? <EmptyState onCreate={newOpportunity} /> : (
            <>
              <div className="context-bar">
                <button className={view === 'capture' ? 'active' : ''} onClick={() => setView('capture')}><span>1</span> Capture</button>
                <i />
                <button className={view === 'shape' ? 'active' : ''} onClick={() => setView('shape')}><span>2</span> Shape</button>
                <i />
                <button className={view === 'decide' ? 'active' : ''} onClick={() => setView('decide')}><span>3</span> Decide</button>
                <div className="stage-pill">{stage}</div>
              </div>

              {notice && <div className="notice success"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice(null)}><X size={15} /></button></div>}
              {error && <div className="notice error"><CircleDot size={17} />{error}<button onClick={() => setError(null)}><X size={15} /></button></div>}

              <LadderRail pitch={selected} update={update} />

              {view === 'capture' && <Capture pitch={selected} update={update} onContinue={() => { if (ladderStage(selected) === 'note') update({ stage: 'proposal' }); setView('shape'); }} />}
              {view === 'shape' && <Shape key={selected.id} pitch={selected} update={update} completed={completed} onDecide={() => setView('decide')} />}
              {view === 'decide' && (
                <Decide
                  pitch={selected}
                  pitches={pitches}
                  update={update}
                  ready={ready}
                  config={config}
                  busy={busy}
                  repositories={repositories}
                  onSelectRepository={selectRepository}
                  onLogout={logout}
                  onPrepare={prepareBet}
                  onRefresh={refreshIssue}
                  previewTriggerRef={previewTriggerRef}
                />
              )}
            </>
          )}
        </main>
      </div>

      {preview && (
        <PreviewModal
          preview={preview}
          mode={config.mode}
          reviewed={reviewed}
          setReviewed={setReviewed}
          busy={busy}
          returnFocusRef={previewTriggerRef}
          onClose={() => { if (!busy) setPreview(null); }}
          onConfirm={confirmBet}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-state"><div className="empty-orbit"><Feather size={34} /></div><span className="kicker">A quiet place to think</span><h1>Start with the opportunity,<br />not the solution.</h1><p>Jot a note the moment something feels off. Shape it into a proposal when it keeps nagging. Bet only when the shape is complete.</p><button className="primary" onClick={onCreate}><Plus size={17} /> Jot a note</button></div>;
}

function LadderRail({ pitch, update }: { pitch: Pitch; update: (patch: Partial<Pitch>) => void }) {
  const stage = ladderStage(pitch);
  const position = LADDER_STAGES.indexOf(stage);
  const linked = Boolean(pitch.github);
  return <div className="ladder-rail" role="group" aria-label="Capture ladder">
    {LADDER_STAGES.map((step, index) => {
      const current = stage === step;
      const clickable = !linked && !current && step !== 'bet';
      return <button key={step} className={`ladder-step ${current ? 'current' : ''} ${index <= position ? 'reached' : ''}`} disabled={!clickable} onClick={() => update({ stage: step })} title={clickable ? `Move this pitch to the ${stageMeta[step].label.toLowerCase()} rung` : undefined}>
        <strong>{stageMeta[step].label}</strong>
        <small>{step === 'bet' && !current ? `${shapedSectionCount(pitch)} of ${fieldMeta.length} shaped` : stageMeta[step].hint}</small>
      </button>;
    })}
    <span className="ladder-note">{linked ? 'Linked to an issue—the ladder is settled.' : 'Moving up is optional. Moving back down loses nothing.'}</span>
  </div>;
}

function Capture({ pitch, update, onContinue }: { pitch: Pitch; update: (patch: Partial<Pitch>) => void; onContinue: () => void }) {
  return <section className="page narrow">
    <div className="page-heading"><span className="kicker">Note · first rung</span><h1>Something feels worth a closer look.</h1><p>A note only needs a name—it saves the moment you type. Everything else is optional, now and later.</p></div>
    <div className="capture-card">
      <label><span>Note <em>the only thing a note needs</em></span><input autoFocus required value={pitch.title} onChange={(e) => update({ title: e.target.value })} placeholder="A short, specific name" /></label>
      <label><span>What did you notice? <em>optional</em></span><textarea rows={4} value={pitch.signal} onChange={(e) => update({ signal: e.target.value })} placeholder="The raw observation, friction, request, or possibility…" /></label>
      <label><span>Source <em>optional</em></span><input value={pitch.source} onChange={(e) => update({ source: e.target.value })} placeholder="Conversation, metric, customer, personal note…" /></label>
      <div className="card-footer"><span>Saved instantly to this browser</span><button className="primary" disabled={!pitch.title.trim()} onClick={onContinue}>{ladderStage(pitch) === 'note' ? 'Shape a proposal — optional' : 'Continue shaping'} <ArrowRight size={17} /></button></div>
    </div>
  </section>;
}

function Shape({ pitch, update, completed, onDecide }: { pitch: Pitch; update: (patch: Partial<Pitch>) => void; completed: number; onDecide: () => void }) {
  const nextField = fieldMeta.find((field) => !pitch[field.key].trim());
  // Shape is keyed by pitch.id, so sparring state can never leak between
  // drafts; the ref additionally drops in-flight suggestions that resolve
  // after this pitch's instance unmounts.
  const [sparringOn, setSparringOn] = useState(false);
  const [suggestions, setSuggestions] = useState<Partial<Record<PitchSectionKey, string>>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function spar(section: PitchSectionKey) {
    stubSparringPartner.suggest(pitch, section).then((text) => {
      if (mounted.current) setSuggestions((current) => ({ ...current, [section]: text }));
    }).catch(() => undefined);
  }
  function dismissSuggestion(section: PitchSectionKey) {
    setSuggestions(({ [section]: _dropped, ...rest }) => rest);
  }

  return <section className="page shape-page">
    <div className="page-heading shape-heading"><div><span className="kicker">Shaping studio</span><h1>{pitch.title || 'Untitled note'}</h1><p>Each card is a decision worth thinking through—and every one is skippable. Only a bet asks for all {fieldMeta.length}.</p></div><div className="progress-ring" aria-label={`${completed} of ${fieldMeta.length} sections shaped`}><strong>{completed}</strong><span>of {fieldMeta.length}</span></div></div>
    <div className={`shape-guidance ${nextField ? '' : 'complete'}`}><CheckCircle2 size={17} /><span>{nextField ? <><strong>{completed} of {fieldMeta.length} shaped.</strong> If you keep going, <strong>{nextField.title.toLowerCase()}</strong> is a good next thought—or skip around freely.</> : <><strong>All {fieldMeta.length} shaped.</strong> Review the decision when you’re ready.</>}</span></div>
    {pitch.signal && <blockquote className="signal-quote"><span>Captured signal</span>{pitch.signal}</blockquote>}
    <label className="sparring-toggle"><input type="checkbox" checked={sparringOn} onChange={(e) => { setSparringOn(e.target.checked); if (!e.target.checked) setSuggestions({}); }} /><span><strong>Sparring partner</strong><small>Opt-in, suggestion-only. A local stub—no AI provider is connected and nothing leaves this browser. Suggestions never touch your draft unless you use one.</small></span></label>
    <div className="shape-fields">
      {fieldMeta.map((field) => {
        const isComplete = Boolean(pitch[field.key].trim());
        const suggestion = suggestions[field.key];
        return <label className={`shape-field ${isComplete ? 'complete' : ''}`} key={field.key}><span className="shape-field-top"><span className="eyebrow">{field.eyebrow}</span><span className="field-requirement">{isComplete ? 'Shaped' : 'Open · skippable'}</span></span><strong>{field.title}</strong><small>{field.prompt}</small><textarea rows={field.key === 'solution' ? 7 : 5} value={pitch[field.key]} onChange={(e) => update({ [field.key]: e.target.value })} placeholder={field.placeholder} />
          {sparringOn && suggestion === undefined && <button type="button" className="spar-button" onClick={() => spar(field.key)}><Sparkles size={13} /> Spar on this section</button>}
          {sparringOn && suggestion !== undefined && <span className="sparring-box"><span className="sparring-label">Suggestion · stub · edit or discard</span><textarea rows={3} value={suggestion} onChange={(e) => setSuggestions((current) => ({ ...current, [field.key]: e.target.value }))} /><span className="sparring-actions"><button type="button" className="secondary" onClick={() => dismissSuggestion(field.key)}>Discard</button><button type="button" className="secondary use" onClick={() => { update({ [field.key]: pitch[field.key].trim() ? `${pitch[field.key]}\n\n${suggestion}` : suggestion }); dismissSuggestion(field.key); }}>Add to draft</button></span></span>}
        </label>;
      })}
    </div>
    <div className="sticky-action"><span><CheckCircle2 size={17} /> Draft saved locally</span><button className="primary" onClick={onDecide}>Review decision <ArrowRight size={17} /></button></div>
  </section>;
}

function Decide({ pitch, pitches, update, ready, config, busy, repositories, onSelectRepository, onLogout, onPrepare, onRefresh, previewTriggerRef }: { pitch: Pitch; pitches: Pitch[]; update: (patch: Partial<Pitch>) => void; ready: boolean; config: AppConfig; busy: boolean; repositories: RepositoryChoice[]; onSelectRepository: (value: string) => void; onLogout: () => void; onPrepare: () => void; onRefresh: () => void; previewTriggerRef: RefObject<HTMLButtonElement | null> }) {
  const targetReady = config.mode === 'demo' || Boolean(config.auth.signedIn && config.repository);
  return <section className="page narrow decision-page">
    <button className="back-link" onClick={() => document.querySelector<HTMLButtonElement>('.context-bar button:nth-of-type(2)')?.click()}><ArrowLeft size={15} /> Back to shaping</button>
    <div className="page-heading"><span className="kicker">Decision point</span><h1>Is this worth the appetite?</h1><p>A decision is useful even when the answer is no.</p></div>

    {config.mode === 'github' && <GitHubConnection config={config} repositories={repositories} busy={busy} onSelectRepository={onSelectRepository} onLogout={onLogout} />}

    {pitch.github && <CanonicalCard github={pitch.github} busy={busy} onRefresh={onRefresh} mode={config.mode} />}

    <div className="decision-grid">
      <button className={`decision-choice ${pitch.decision === 'pass' ? 'selected pass' : ''}`} onClick={() => update({ decision: 'pass' })}><span className="decision-icon"><X size={20} /></span><strong>Pass for now</strong><small>Keep the shaped thinking. Make no GitHub write.</small></button>
      <button className={`decision-choice ${pitch.decision === 'bet' ? 'selected bet' : ''}`} onClick={() => update({ decision: 'bet', stage: 'bet' })}><span className="decision-icon"><Check size={20} /></span><strong>Make the bet</strong><small>Prepare a canonical GitHub Issue for review.</small></button>
    </div>
    <div className="readiness-card">
      <div><span className="kicker">Bet readiness</span><strong>{ready ? 'The pitch has a complete shape.' : `${shapedSectionCount(pitch)} of ${fieldMeta.length} shaped so far.`}</strong><p>{ready ? 'You can review the exact GitHub write. Nothing is sent until you confirm.' : 'A note or proposal can stay open-ended forever. Only a bet asks for all seven sections.'}</p></div>
      <div className={`readiness-mark ${ready ? 'ready' : ''}`}>{ready ? <Check size={22} /> : `${shapedSectionCount(pitch)}/${fieldMeta.length}`}</div>
    </div>
    <MapPlacement pitch={pitch} pitches={pitches} update={update} />
    <button ref={previewTriggerRef} className="bet-button" disabled={!canPreviewBet(pitch) || busy || !targetReady} onClick={onPrepare}>{busy ? <Loader2 className="spin" size={18} /> : <GitPullRequest size={18} />}{!targetReady ? 'Connect GitHub and choose a repository' : pitch.github ? 'Review GitHub update' : 'Review and make the bet'}<ArrowRight size={18} /></button>
    <p className="write-boundary"><ShieldCheck size={15} /> This opens a precise preview. A second confirmation is required for every write.</p>
  </section>;
}

function MapPlacement({ pitch, pitches, update }: { pitch: Pitch; pitches: Pitch[]; update: (patch: Partial<Pitch>) => void }) {
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [depError, setDepError] = useState<string | null>(null);
  const dependencies = pitch.dependencies ?? [];
  const byId = new Map(pitches.map((item) => [item.id, item]));
  const candidates = pitches.filter((item) => item.id !== pitch.id && ladderStage(item) !== 'note' && !dependencies.some((edge) => edge.pitchId === item.id));

  function addDependency() {
    if (!targetId || !reason.trim()) return;
    const error = dependencyCycleError(pitches, pitch.id, targetId);
    if (error) { setDepError(error); return; }
    update({ dependencies: [...dependencies, { pitchId: targetId, reason: reason.trim() }] });
    setTargetId(''); setReason(''); setDepError(null);
  }

  return <div className="placement-card">
    <span className="kicker">Bet map placement</span>
    <p>Local-only roadmap metadata. Horizons describe intent—never committed dates—and none of this is written to GitHub.</p>
    <div className="placement-grid">
      <label><span>Horizon</span>
        <select value={horizonOf(pitch)} onChange={(e) => update({ horizon: e.target.value })}>
          {DEFAULT_HORIZONS.map((horizon) => <option key={horizon.id} value={horizon.id}>{horizon.label} · {horizon.hint.toLowerCase()}</option>)}
        </select>
      </label>
      <label><span>Appetite band</span>
        <select value={pitch.appetiteBand ?? ''} onChange={(e) => update({ appetiteBand: e.target.value || undefined })}>
          <option value="">Not set</option>
          {APPETITE_BANDS.map((band) => <option key={band} value={band}>{APPETITE_BAND_LABELS[band]}</option>)}
        </select>
      </label>
      <label><span>Confidence</span>
        <select value={pitch.confidence ?? ''} onChange={(e) => update({ confidence: e.target.value || undefined })}>
          <option value="">Not set</option>
          {CONFIDENCE_LEVELS.map((level) => <option key={level} value={level}>{level[0].toUpperCase()}{level.slice(1)}</option>)}
        </select>
      </label>
    </div>
    {dependencies.length > 0 && <ul className="placement-deps">
      {dependencies.map((edge) => {
        const target = byId.get(edge.pitchId);
        return <li key={edge.pitchId}>
          <span><strong>Needs {target ? target.title.trim() || 'Untitled note' : 'a pitch no longer in this workspace'}</strong>{edge.reason ? ` — ${edge.reason}` : ''}{!target && ' · ignored by the map and exports'}</span>
          <button className="icon-button" aria-label={`Remove dependency on ${target?.title.trim() || 'removed pitch'}`} onClick={() => update({ dependencies: dependencies.filter((item) => item.pitchId !== edge.pitchId) })}><X size={13} /></button>
        </li>;
      })}
    </ul>}
    <div className="placement-add">
      <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setDepError(null); }} aria-label="Pitch this one depends on">
        <option value="">Depends on…</option>
        {candidates.map((item) => <option key={item.id} value={item.id}>{item.title.trim() || 'Untitled note'}</option>)}
      </select>
      <input value={reason} onChange={(e) => { setReason(e.target.value); setDepError(null); }} placeholder="Why does it depend on that?" aria-label="Dependency reason" />
      <button className="secondary" disabled={!targetId || !reason.trim()} onClick={addDependency}><Plus size={14} /> Add</button>
    </div>
    {depError && <p className="placement-error" role="alert">{depError}</p>}
  </div>;
}

function GitHubConnection({ config, repositories, busy, onSelectRepository, onLogout }: { config: AppConfig; repositories: RepositoryChoice[]; busy: boolean; onSelectRepository: (value: string) => void; onLogout: () => void }) {
  if (!config.auth.signedIn) return <div className="connection-card signed-out"><span className="connection-icon"><LockKeyhole size={20} /></span><div><span className="kicker">GitHub connection</span><strong>Sign in when you’re ready to place a bet.</strong><p>The OAuth token stays in a protected server session. Draft shaping remains local.</p><small>{config.oauthScope === 'repo' ? 'This app requests GitHub’s broad repo scope because private-repository Issue access cannot be scoped more narrowly with an OAuth App.' : 'This app requests public_repo, GitHub’s narrowest OAuth scope that can create Issues in public repositories.'}</small></div><a className="primary oauth-button" href="/api/auth/github"><GitPullRequest size={17} /> Sign in with GitHub</a></div>;

  return <div className="connection-card"><div className="connection-user">{config.auth.user?.avatarUrl ? <img src={config.auth.user.avatarUrl} alt="" /> : <span className="connection-icon"><GitPullRequest size={20} /></span>}<div><span className="kicker">Signed in</span><strong>@{config.auth.user?.login}</strong></div></div><label className="repo-select"><span>Canonical issue repository</span><select value={config.repository?.fullName || ''} onChange={(event) => onSelectRepository(event.target.value)} disabled={busy}><option value="">Choose a writable repository…</option>{repositories.map((repository) => <option value={repository.fullName} key={repository.id}>{repository.fullName}{repository.private ? ' · private' : ''}</option>)}</select><small>Selection limits this app’s writes, but not the OAuth grant itself.</small></label><button className="logout-button" onClick={onLogout} disabled={busy}><LogOut size={14} /> Sign out</button></div>;
}

function CanonicalCard({ github, busy, onRefresh, mode }: { github: GitHubSnapshot; busy: boolean; onRefresh: () => void; mode: AppConfig['mode'] }) {
  return <div className="canonical-card"><div className="canonical-top"><span className="github-icon"><GitPullRequest size={19} /></span><div><span>{mode === 'demo' ? 'Simulated canonical issue' : 'Canonical GitHub issue'}</span><strong>{github.owner}/{github.repo} #{github.number}</strong></div><span className="synced"><CircleDot size={12} /> Synced {relativeDate(github.lastSyncedAt)}</span></div><h3>{github.title}</h3><p>{github.body.replace(/[#>*_\-]/g, '').slice(0, 160)}…</p><div className="canonical-actions">{mode === 'github' ? <a href={github.url} target="_blank" rel="noreferrer">Open issue <ExternalLink size={14} /></a> : <span className="simulated-link">Simulated link · no GitHub page</span>}<button onClick={onRefresh} disabled={busy}>{busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} {mode === 'demo' ? 'Refresh demo issue' : 'Refresh from GitHub'}</button></div><small>GitHub owns issue identity, content and state. This app keeps the local shaping draft and decision rationale.</small></div>;
}

function PreviewModal({ preview, mode, reviewed, setReviewed, busy, returnFocusRef, onClose, onConfirm }: { preview: IssuePreview; mode: AppConfig['mode']; reviewed: boolean; setReviewed: (value: boolean) => void; busy: boolean; returnFocusRef: RefObject<HTMLButtonElement | null>; onClose: () => void; onConfirm: () => void }) {
  const action = preview.action === 'create' ? 'Create' : 'Update';
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    const focusable = () => Array.from(modal?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      (returnFocusRef.current ?? previousFocus.current)?.focus();
    };
  }, []);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="preview-title"><div className="modal-head"><div><span className="kicker">Exact write preview</span><h2 id="preview-title">{action} {mode === 'demo' ? 'a simulated issue' : 'one GitHub Issue'}</h2></div><button className="icon-button" aria-label="Close write preview" onClick={onClose} disabled={busy}><X size={19} /></button></div><div className="write-summary"><div><span>Action</span><strong>{preview.action}{preview.issueNumber ? ` #${preview.issueNumber}` : ''}</strong></div><div><span>Repository</span><strong>{preview.target}</strong></div><div><span>Labels / assignees</span><strong>None</strong></div></div>{mode === 'demo' && <div className="demo-callout"><Sparkles size={16} /> Safe demo: confirming will not contact GitHub.</div>}<div className="payload"><span>Issue title</span><h3>{preview.title}</h3><span>Issue body</span><pre>{preview.body}</pre></div><label className="confirm-check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /><span><strong>I reviewed this exact write.</strong><small>No closing, deleting, relabeling, assigning, or cross-repository changes will occur.</small></span></label><div className="modal-actions"><button className="secondary" onClick={onClose} disabled={busy}>Cancel · no write</button><button className="primary danger" onClick={onConfirm} disabled={!reviewed || busy}>{busy ? <Loader2 className="spin" size={17} /> : <GitPullRequest size={17} />}{mode === 'demo' ? `${action} demo issue` : `${action} GitHub issue`}</button></div></div></div>;
}
