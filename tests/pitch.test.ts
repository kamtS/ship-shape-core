import { describe, expect, it } from 'vitest';
import { createEmptyPitch, isBetReady, renderIssueBody, type Pitch } from '../shared/pitch.js';

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
