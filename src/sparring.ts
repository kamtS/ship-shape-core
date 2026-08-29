import type { Pitch, PitchSectionKey } from '../shared/pitch';

// A sparring partner offers a starting point for one shaping section. It never
// writes into a pitch: the UI shows the suggestion for editing or discarding,
// and only an explicit user action copies it into the draft.
export interface SparringPartner {
  name: string;
  suggest(pitch: Pitch, section: PitchSectionKey): Promise<string>;
}

function against(pitch: Pitch): string {
  return pitch.title.trim() ? `“${pitch.title.trim()}”` : 'this note';
}

const openers: Record<PitchSectionKey, (pitch: Pitch) => string> = {
  problem: (pitch) => `Who runs into ${against(pitch)}, and in what moment? Try finishing: “When ___ tries to ___, they get stuck because ___.” Name the struggle, not the missing feature.`,
  evidence: (pitch) => `List the concrete moments behind ${against(pitch)}: dates, quotes, numbers, or repeated behaviour.${pitch.signal.trim() ? ` Your captured signal is a start: “${pitch.signal.trim()}”.` : ''} One durable pattern beats three opinions.`,
  appetite: () => 'Pick a budget you would be happy to lose: an afternoon, three days, one focused week. Then add a stop condition: “Stop if ___ after ___.”',
  constraints: () => 'Write three no-gos that keep this small. What adjacent work will you refuse even if it looks easy once you are in there?',
  solution: (pitch) => `Sketch the smallest version of ${against(pitch)} that a person could actually use: the key screens or steps, in order, without locking every detail.`,
  risks: () => 'Name the part you understand least—that is usually the rabbit hole. What would you check in the first day to find out if it sinks the bet?',
  decisionRationale: (pitch) => `Make the tradeoff legible: why is ${against(pitch)} worth its appetite right now, and what are you choosing not to do instead?`,
};

// Placeholder implementation. No AI provider is wired up: suggestions are
// canned prompts assembled locally from the draft, and nothing leaves the
// browser. Swap this object for a real provider behind the same interface.
export const stubSparringPartner: SparringPartner = {
  name: 'Sparring stub',
  suggest: async (pitch, section) => openers[section](pitch),
};
