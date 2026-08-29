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
  // Advisory client workflow metadata: the rung the user promoted this pitch
  // to. The server cannot verify promotion and must never treat the stored
  // stage as a security property—the write gate rests on the Bet decision
  // plus isBetReady, which the server checks independently.
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
  if (pitch.github) return 'bet';
  const claimed = pitch.stage ?? legacyStage(pitch);
  if (claimed === 'bet' && !(pitch.decision === 'bet' && isBetReady(pitch))) return 'proposal';
  return claimed;
}

export function canPreviewBet(pitch: Pitch): boolean {
  return ladderStage(pitch) === 'bet' && pitch.decision === 'bet' && isBetReady(pitch);
}

const PITCH_STRING_FIELDS: Array<keyof Pitch> = [
  'id',
  'title',
  'signal',
  'source',
  'problem',
  'evidence',
  'appetite',
  'constraints',
  'solution',
  'risks',
  'decisionRationale',
  'createdAt',
  'updatedAt',
];

const DECISIONS: Decision[] = ['undecided', 'bet', 'pass'];

const SNAPSHOT_STRING_FIELDS: Array<keyof GitHubSnapshot> = ['owner', 'repo', 'url', 'title', 'body', 'updatedAt', 'lastSyncedAt'];

function assertValidSnapshot(snapshot: GitHubSnapshot): void {
  if (typeof snapshot !== 'object' || snapshot === null) throw new TypeError('GitHub snapshot must be an object.');
  for (const field of SNAPSHOT_STRING_FIELDS) {
    if (typeof snapshot[field] !== 'string') throw new TypeError(`GitHub snapshot field "${String(field)}" must be a string.`);
  }
  if (!Number.isSafeInteger(snapshot.number) || snapshot.number <= 0) throw new TypeError('GitHub snapshot needs a positive issue number.');
  if (snapshot.state !== 'open' && snapshot.state !== 'closed') throw new TypeError('GitHub snapshot state is not recognised.');
}

// Validates field types before accepting a stored record—regardless of any
// stage it claims—so a malformed entry throws here and callers with a
// non-destructive policy (loadPitches) can skip it instead of admitting a
// pitch that crashes rendering later. An unrecognised stage is derived, not
// rejected, to keep legacy drafts loadable.
export function normalisePitch(pitch: Pitch): Pitch {
  for (const field of PITCH_STRING_FIELDS) {
    if (typeof pitch[field] !== 'string') throw new TypeError(`Pitch field "${String(field)}" must be a string.`);
  }
  if (!DECISIONS.includes(pitch.decision)) throw new TypeError('Pitch decision is not recognised.');
  // A malformed snapshot rejects the whole record rather than dropping the
  // snapshot: silently unlinking would let a later bet create a duplicate
  // canonical issue, and a coerced snapshot could fake a link.
  if (pitch.github !== undefined) assertValidSnapshot(pitch.github);
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
