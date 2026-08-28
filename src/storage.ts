import type { Pitch } from '../shared/pitch';

const KEY = 'ship-shape:pitches:v1';

export function loadPitches(): Pitch[] {
  try {
    const value = localStorage.getItem(KEY);
    return value ? JSON.parse(value) as Pitch[] : [];
  } catch {
    return [];
  }
}

export function savePitches(pitches: Pitch[]): void {
  localStorage.setItem(KEY, JSON.stringify(pitches));
}
