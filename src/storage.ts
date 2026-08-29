import { normalisePitch, type Pitch } from '../shared/pitch.js';

const KEY = 'ship-shape:pitches:v1';

export function loadPitches(): Pitch[] {
  let parsed: unknown;
  try {
    const value = localStorage.getItem(KEY);
    parsed = value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const pitches: Pitch[] = [];
  for (const entry of parsed) {
    // Normalise per entry: one malformed record must never fail the whole
    // load, or the autosave effect would persist an empty inbox over
    // otherwise valid drafts.
    try {
      pitches.push(normalisePitch(entry as Pitch));
    } catch {
      // Skip only the unreadable entry and keep the rest.
    }
  }
  return pitches;
}

export function savePitches(pitches: Pitch[]): void {
  localStorage.setItem(KEY, JSON.stringify(pitches));
}

const STORAGE_NOTE_KEY = 'ship-shape:storage-note-dismissed:v1';

export function isStorageNoteDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_NOTE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function dismissStorageNote(): void {
  try {
    localStorage.setItem(STORAGE_NOTE_KEY, 'true');
  } catch {
    // The note simply reappears next visit if storage is unavailable.
  }
}
