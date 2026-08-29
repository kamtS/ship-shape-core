import { normalisePitch, type Pitch } from '../shared/pitch';

const KEY = 'ship-shape:pitches:v1';

export function loadPitches(): Pitch[] {
  try {
    const value = localStorage.getItem(KEY);
    return value ? (JSON.parse(value) as Pitch[]).map(normalisePitch) : [];
  } catch {
    return [];
  }
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
