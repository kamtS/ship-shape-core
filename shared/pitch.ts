export type Decision = 'undecided' | 'bet' | 'pass';

export type LadderStage = 'note' | 'proposal' | 'bet';

export const LADDER_STAGES: LadderStage[] = ['note', 'proposal', 'bet'];

export interface GitHubSnapshot {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  updatedAt: string;
  lastSyncedAt: string;
}

export interface Pitch {
  id: string;
  title: string;
  signal: string;
  source: string;
  problem: string;
  evidence: string;
  appetite: string;
  constraints: string;
  solution: string;
  risks: string;
  decision: Decision;
  decisionRationale: string;
  stage?: LadderStage;
  createdAt: string;
  updatedAt: string;
  github?: GitHubSnapshot;
}

export type PitchSectionKey =
  | 'problem'
  | 'evidence'
  | 'appetite'
  | 'constraints'
  | 'solution'
  | 'risks'
  | 'decisionRationale';

export const REQUIRED_FOR_BET: PitchSectionKey[] = [
  'problem',
  'evidence',
  'appetite',
  'constraints',
  'solution',
  'risks',
  'decisionRationale',
];

export function missingBetFields(pitch: Pitch): PitchSectionKey[] {
  return REQUIRED_FOR_BET.filter((field) => !pitch[field].trim());
}

export function isBetReady(pitch: Pitch): boolean {
  return Boolean(pitch.title.trim()) && missingBetFields(pitch).length === 0;
}

export function shapedSectionCount(pitch: Pitch): number {
  return REQUIRED_FOR_BET.length - missingBetFields(pitch).length;
}

function legacyStage(pitch: Pitch): LadderStage {
  if (pitch.github || (pitch.decision === 'bet' && isBetReady(pitch))) return 'bet';
  return shapedSectionCount(pitch) > 0 ? 'proposal' : 'note';
}

export function ladderStage(pitch: Pitch): LadderStage {
  const claimed = pitch.stage ?? legacyStage(pitch);
  if (claimed === 'bet' && !pitch.github && !(pitch.decision === 'bet' && isBetReady(pitch))) return 'proposal';
  return claimed;
}

export function canPreviewBet(pitch: Pitch): boolean {
  return ladderStage(pitch) === 'bet' && pitch.decision === 'bet' && isBetReady(pitch);
}

export function normalisePitch(pitch: Pitch): Pitch {
  return LADDER_STAGES.includes(pitch.stage as LadderStage) ? pitch : { ...pitch, stage: legacyStage(pitch) };
}

function section(title: string, content: string): string {
  return `## ${title}\n\n${content.trim() || '_Not provided_'}`;
}

export function renderIssueBody(pitch: Pitch): string {
  return [
    `<!-- ship-shape:v1 pitch:${pitch.id} -->`,
    '> A shaped bet. GitHub is the canonical record after this issue is created.',
    section('Problem', pitch.problem),
    section('Evidence', pitch.evidence),
    section('Appetite', pitch.appetite),
    section('Constraints / no-gos', pitch.constraints),
    section('Solution sketch', pitch.solution),
    section('Risks / open questions', pitch.risks),
    section('Decision', `**Bet**\n\n${pitch.decisionRationale}`),
    `---\n_Captured from ${pitch.source.trim() || 'a local opportunity'}._`,
  ].join('\n\n');
}

export function createEmptyPitch(): Pitch {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: '',
    signal: '',
    source: '',
    problem: '',
    evidence: '',
    appetite: '',
    constraints: '',
    solution: '',
    risks: '',
    decision: 'undecided',
    decisionRationale: '',
    stage: 'note',
    createdAt: now,
    updatedAt: now,
  };
}
