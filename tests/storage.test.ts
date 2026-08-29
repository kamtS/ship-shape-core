import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPitch, type Pitch } from '../shared/pitch.js';
import { dismissStorageNote, isStorageNoteDismissed, loadPitches, savePitches } from '../src/storage.js';

const KEY = 'ship-shape:pitches:v1';

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

describe('localStorage persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips partial pitches and normalises legacy drafts on load', () => {
    const note: Pitch = { ...createEmptyPitch(), title: 'Just a nagging feeling' };
    const proposal: Pitch = { ...createEmptyPitch(), title: 'Half shaped', problem: 'A real drag', appetite: 'Two days', stage: 'proposal' };
    const { stage: _stage, ...legacy } = { ...createEmptyPitch(), title: 'From an old browser', risks: 'Unknown' };
    savePitches([note, proposal, legacy as Pitch]);
    const loaded = loadPitches();
    expect(loaded[0]).toEqual(note);
    expect(loaded[1]).toEqual(proposal);
    expect(loaded[2]).toEqual({ ...legacy, stage: 'proposal' });
  });

  it('keeps valid drafts when stored entries are malformed, staged or not', () => {
    const keeper: Pitch = { ...createEmptyPitch(), title: 'Worth keeping' };
    const { stage: _stage, ...legacyKeeper } = { ...createEmptyPitch(), title: 'Legacy keeper', problem: 'Still real' };
    const malformedLegacy = { id: 'broken', title: 42, decision: 'undecided' };
    const malformedStaged = { id: 'broken-staged', stage: 'note', title: 42, decision: 'undecided' };
    const malformedDecision = { ...createEmptyPitch(), title: 'Bad decision', decision: 'maybe' };
    const malformedSnapshot = { ...createEmptyPitch(), title: 'Fake link', github: { body: 42 } };
    const nonObjectSnapshot = { ...createEmptyPitch(), title: 'Bool link', github: true };
    const linkedKeeper: Pitch = { ...createEmptyPitch(), title: 'Properly linked', stage: 'bet', github: {
      owner: 'demo-workspace', repo: 'ship-shape-sandbox', number: 41, url: 'https://example.test/41',
      title: 'Properly linked', body: '<!-- ship-shape:v1 pitch:linked-keeper -->', state: 'open',
      updatedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString(),
    } };
    localStorage.setItem(KEY, JSON.stringify([keeper, malformedLegacy, malformedStaged, malformedDecision, malformedSnapshot, nonObjectSnapshot, legacyKeeper, linkedKeeper, null]));
    const loaded = loadPitches();
    expect(loaded).toHaveLength(3);
    expect(loaded[0]).toEqual(keeper);
    expect(loaded[1]).toEqual({ ...legacyKeeper, stage: 'proposal' });
    expect(loaded[2]).toEqual(linkedKeeper);
  });

  it('returns an empty inbox for unreadable or non-array storage without throwing', () => {
    localStorage.setItem(KEY, 'not json at all');
    expect(loadPitches()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(loadPitches()).toEqual([]);
    localStorage.removeItem(KEY);
    expect(loadPitches()).toEqual([]);
  });

  it('persists the storage-note dismissal flag', () => {
    expect(isStorageNoteDismissed()).toBe(false);
    dismissStorageNote();
    expect(isStorageNoteDismissed()).toBe(true);
  });
});
