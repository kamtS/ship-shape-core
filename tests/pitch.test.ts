import { describe, expect, it } from 'vitest';
import {
  canPreviewBet,
  createEmptyPitch,
  isBetReady,
  ladderStage,
  normalisePitch,
  renderIssueBody,
  shapedSectionCount,
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
