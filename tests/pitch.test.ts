import { describe, expect, it } from 'vitest';
import {
  annotatedDependencies,
  canonicalDependencies,
  canPreviewBet,
  createEmptyPitch,
  DEFAULT_HORIZONS,
  dependencyCandidates,
  dependencyCycleError,
  effectiveHorizons,
  fallbackHorizonId,
  horizonOf,
  isBetReady,
  ladderStage,
  normalisePitch,
  renderIssueBody,
  resolvableDependencies,
  shapedSectionCount,
  withoutDependency,
  type Pitch,
} from '../shared/pitch.js';

function completePitch(): Pitch {
  return {
    ...createEmptyPitch(),
    id: 'pitch-123',
    title: 'Make weekly review frictionless',
    source: 'Three abandoned reviews',
    problem: 'Reviews take too long to start.',
    evidence: 'Three recent sessions stopped before the first step.',
    appetite: 'One focused week.',
    constraints: 'No reminders. No mobile app.',
    solution: 'A single guided review flow.',
    risks: 'Importing old data could become a rabbit hole.',
    decision: 'bet',
    decisionRationale: 'The signal is repeated and the boundary is small.',
    stage: 'bet',
  };
}

function linkedSnapshot() {
  return {
    owner: 'demo-workspace', repo: 'ship-shape-sandbox', number: 41, url: 'https://example.test/41',
    title: 'A bounded bet', body: '<!-- ship-shape:v1 pitch:pitch-123 -->', state: 'open' as const,
    updatedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString(),
  };
}

describe('pitch shaping', () => {
  it('requires a title and every shaping section before a bet', () => {
    expect(isBetReady(createEmptyPitch())).toBe(false);
    expect(isBetReady(completePitch())).toBe(true);
  });

  it('renders a complete, stable GitHub issue body', () => {
    const body = renderIssueBody(completePitch());
    expect(body).toContain('<!-- ship-shape:v1 pitch:pitch-123 -->');
    for (const heading of ['Problem', 'Evidence', 'Appetite', 'Constraints / no-gos', 'Solution sketch', 'Risks / open questions', 'Decision']) {
      expect(body).toContain(`## ${heading}`);
    }
    expect(body).toContain('**Bet**');
  });
});

describe('capture ladder', () => {
  it('starts every pitch as a note', () => {
    const pitch = createEmptyPitch();
    expect(pitch.stage).toBe('note');
    expect(ladderStage(pitch)).toBe('note');
    expect(shapedSectionCount(pitch)).toBe(0);
  });

  it('lets a note or proposal persist with any subset of sections complete', () => {
    const partial: Pitch = { ...createEmptyPitch(), title: 'A hunch', problem: 'Something drags', evidence: 'Two examples', stage: 'proposal' };
    expect(ladderStage(partial)).toBe('proposal');
    expect(shapedSectionCount(partial)).toBe(2);
    expect(isBetReady(partial)).toBe(false);
    const demoted: Pitch = { ...partial, stage: 'note' };
    expect(ladderStage(demoted)).toBe('note');
  });

  it('clamps a claimed bet back to proposal until the shape is complete and chosen', () => {
    const incomplete: Pitch = { ...createEmptyPitch(), title: 'Eager', problem: 'Half shaped', decision: 'bet', stage: 'bet' };
    expect(ladderStage(incomplete)).toBe('proposal');
    expect(canPreviewBet(incomplete)).toBe(false);
    const undecided: Pitch = { ...completePitch(), decision: 'undecided' };
    expect(ladderStage(undecided)).toBe('proposal');
    expect(canPreviewBet(undecided)).toBe(false);
    expect(ladderStage(completePitch())).toBe('bet');
    expect(canPreviewBet(completePitch())).toBe(true);
  });

  it('keeps a proposal below the bet gate even when the shape is complete', () => {
    const holdingBack: Pitch = { ...completePitch(), stage: 'proposal' };
    expect(ladderStage(holdingBack)).toBe('proposal');
    expect(canPreviewBet(holdingBack)).toBe(false);
  });

  it('treats a linked pitch as a bet regardless of the stored rung', () => {
    const linked: Pitch = { ...completePitch(), github: linkedSnapshot() };
    expect(ladderStage(linked)).toBe('bet');
    const contradictory: Pitch = { ...linked, stage: 'note', decision: 'undecided', problem: '', evidence: '', appetite: '', constraints: '', solution: '', risks: '', decisionRationale: '' };
    expect(ladderStage(contradictory)).toBe('bet');
    expect(ladderStage({ ...linked, stage: 'proposal' })).toBe('bet');
  });

  it('derives a stage for legacy drafts and survives a serialisation round-trip', () => {
    const { stage: _stage, ...legacyFields } = completePitch();
    const legacyBet = legacyFields as Pitch;
    expect(ladderStage(legacyBet)).toBe('bet');
    expect(normalisePitch(legacyBet).stage).toBe('bet');
    const legacyNote = { ...legacyBet, decision: 'undecided', problem: '', evidence: '', appetite: '', constraints: '', solution: '', risks: '', decisionRationale: '' } as Pitch;
    expect(normalisePitch(legacyNote).stage).toBe('note');
    expect(normalisePitch({ ...legacyNote, problem: 'One shaped section' }).stage).toBe('proposal');

    const proposal: Pitch = { ...createEmptyPitch(), title: 'Round trip', problem: 'Persist me', stage: 'proposal' };
    const revived = JSON.parse(JSON.stringify(proposal)) as Pitch;
    expect(revived).toEqual(proposal);
    expect(normalisePitch(revived)).toEqual(proposal);
    expect(ladderStage(revived)).toBe(ladderStage(proposal));
  });
});

function mapPitch(id: string, title: string, patch: Partial<Pitch> = {}): Pitch {
  return { ...createEmptyPitch(), id, title, problem: 'Something drags', stage: 'proposal', ...patch };
}

describe('bet map model', () => {
  it('starts new pitches unscheduled on the furthest horizon with no dependencies', () => {
    const pitch = createEmptyPitch();
    expect(pitch.horizon).toBe('later');
    expect(pitch.dependencies).toEqual([]);
    expect(pitch.appetiteBand).toBeUndefined();
    expect(pitch.confidence).toBeUndefined();
  });

  it('keeps the issue body free of bet-map metadata', () => {
    const pitch = { ...completePitch(), horizon: 'now', appetiteBand: 'medium', confidence: 'high', dependencies: [{ pitchId: 'x', reason: 'sequencing' }] } as Pitch;
    const body = renderIssueBody(pitch);
    expect(body).toBe(renderIssueBody(completePitch()));
    for (const leak of ['horizon', 'confidence', 'sequencing', 'appetiteBand']) expect(body).not.toContain(leak);
  });

  it('backfills legacy pitches and drops malformed bet-map fields', () => {
    const { stage: _stage, horizon: _h, dependencies: _d, ...legacyFields } = completePitch();
    const legacy = normalisePitch(legacyFields as Pitch);
    expect(legacy.horizon).toBe('later');
    expect(legacy.dependencies).toEqual([]);
    const mangled = normalisePitch({ ...completePitch(), appetiteBand: 42, confidence: { level: 'high' }, horizon: '', dependencies: [{ pitchId: 42 }, null, { pitchId: 'other', reason: 7 }] } as unknown as Pitch);
    expect(mangled.appetiteBand).toBeUndefined();
    expect(mangled.confidence).toBeUndefined();
    expect(mangled.horizon).toBe('later');
    expect(mangled.dependencies).toEqual([{ pitchId: 'other', reason: '' }]);
  });

  it('preserves unknown band and confidence strings from newer app versions', () => {
    const future = normalisePitch({ ...completePitch(), appetiteBand: 'gigantic', confidence: 'certain' } as Pitch);
    expect(future.appetiteBand).toBe('gigantic');
    expect(future.confidence).toBe('certain');
    const roundTripped = normalisePitch(JSON.parse(JSON.stringify(future)) as Pitch);
    expect(roundTripped.appetiteBand).toBe('gigantic');
    expect(roundTripped.confidence).toBe('certain');
  });

  it('canonically sorts and deduplicates dependency edges', () => {
    const edges = [
      { pitchId: 'b', reason: 'later' },
      { pitchId: 'a', reason: 'z-reason' },
      { pitchId: 'b', reason: 'later' },
      { pitchId: 'a', reason: 'a-reason' },
    ];
    expect(canonicalDependencies(edges)).toEqual([
      { pitchId: 'a', reason: 'a-reason' },
      { pitchId: 'a', reason: 'z-reason' },
      { pitchId: 'b', reason: 'later' },
    ]);
    const pitch = normalisePitch({ ...completePitch(), dependencies: [...edges] } as Pitch);
    expect(pitch.dependencies).toEqual(canonicalDependencies(edges));
  });

  it('tolerates an empty horizon configuration by falling back to the defaults', () => {
    expect(fallbackHorizonId([])).toBe('later');
    expect(horizonOf(mapPitch('a', 'A', { horizon: 'now' }), [])).toBe('now');
    expect(horizonOf(mapPitch('a', 'A', { horizon: 'someday' }), [])).toBe('later');
    expect(effectiveHorizons([])).toEqual(DEFAULT_HORIZONS);
    expect(effectiveHorizons()).toEqual(DEFAULT_HORIZONS);
  });

  it('annotates every stored edge with an explicit status', () => {
    const a = mapPitch('a', 'Alpha', {
      dependencies: [
        { pitchId: 'gone', reason: 'was deleted' },
        { pitchId: 'b', reason: 'still here' },
        { pitchId: 'c', reason: 'demoted' },
        { pitchId: 'a', reason: 'self' },
      ],
    });
    const b = mapPitch('b', 'Beta');
    const c = mapPitch('c', 'Gamma', { stage: 'note', problem: '' });
    const annotated = annotatedDependencies(a, [a, b, c]);
    expect(annotated.map((edge) => [edge.pitchId, edge.status])).toEqual([
      ['b', 'ok'],
      ['c', 'note'],
      ['gone', 'missing'],
    ]);
    expect(annotated[0].target?.title).toBe('Beta');
    expect(annotated[2].target).toBeUndefined();
  });

  it('round-trips structured bet-map fields through the JSON contract', () => {
    const pitch: Pitch = { ...completePitch(), appetiteBand: 'small', confidence: 'medium', horizon: 'next', dependencies: [{ pitchId: 'dep-1', reason: 'Needs the shared model first' }] };
    const revived = normalisePitch(JSON.parse(JSON.stringify(pitch)) as Pitch);
    expect(revived).toEqual(pitch);
  });

  it('maps unknown horizons onto the furthest configured horizon', () => {
    expect(horizonOf(mapPitch('a', 'A', { horizon: 'now' }))).toBe('now');
    expect(horizonOf(mapPitch('a', 'A', { horizon: 'someday' }))).toBe('later');
    expect(horizonOf(mapPitch('a', 'A', { horizon: 'q3' }), [{ id: 'q3', label: 'Q3', hint: '' }, { id: 'q4', label: 'Q4', hint: '' }])).toBe('q3');
    expect(DEFAULT_HORIZONS.map((horizon) => horizon.id)).toEqual(['now', 'next', 'later']);
  });

  it('rejects self, direct, and transitive dependency cycles with a legible loop', () => {
    const a = mapPitch('a', 'Alpha', { dependencies: [{ pitchId: 'b', reason: 'b first' }] });
    const b = mapPitch('b', 'Beta', { dependencies: [{ pitchId: 'c', reason: 'c first' }] });
    const c = mapPitch('c', 'Gamma');
    const pitches = [a, b, c];
    expect(dependencyCycleError(pitches, 'a', 'a')).toContain('cannot depend on itself');
    expect(dependencyCycleError(pitches, 'b', 'a')).toContain('loop');
    expect(dependencyCycleError(pitches, 'c', 'a')).toBe('This dependency would create a loop: “Gamma” → “Alpha” → “Beta” → “Gamma”.');
    expect(dependencyCycleError(pitches, 'c', 'b')).toContain('loop');
    expect(dependencyCycleError(pitches, 'a', 'c')).toBeNull();
    expect(dependencyCycleError(pitches, 'b', 'a')).toContain('“Beta”');
  });

  it('removes exactly one edge, matching target and reason', () => {
    const edges = [
      { pitchId: 'a', reason: 'first' },
      { pitchId: 'a', reason: 'second' },
      { pitchId: 'b', reason: 'first' },
    ];
    expect(withoutDependency(edges, { pitchId: 'a', reason: 'second' })).toEqual([
      { pitchId: 'a', reason: 'first' },
      { pitchId: 'b', reason: 'first' },
    ]);
    expect(withoutDependency(edges, { pitchId: 'missing', reason: 'first' })).toEqual(edges);
  });

  it('offers only proposals and bets that are not already dependencies as candidates', () => {
    const self = mapPitch('self', 'Self', { dependencies: [{ pitchId: 'taken', reason: 'already linked' }] });
    const taken = mapPitch('taken', 'Taken');
    const note = mapPitch('note', 'Still a note', { stage: 'note', problem: '' });
    const open = mapPitch('open', 'Open target');
    expect(dependencyCandidates(self, [self, taken, note, open]).map((item) => item.id)).toEqual(['open']);
  });

  it('ignores dependency edges whose target has been deleted', () => {
    const a = mapPitch('a', 'Alpha', { dependencies: [{ pitchId: 'gone', reason: 'was deleted' }, { pitchId: 'b', reason: 'still here' }, { pitchId: 'a', reason: 'self' }] });
    const b = mapPitch('b', 'Beta');
    expect(resolvableDependencies(a, [a, b])).toEqual([{ pitchId: 'b', reason: 'still here' }]);
    expect(dependencyCycleError([a, b], 'b', 'a')).toContain('loop');
  });
});
