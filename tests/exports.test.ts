import { describe, expect, it } from 'vitest';
import { mappablePitches, orderForExport, renderMarkdownMap, renderMermaidMap } from '../shared/exports.js';
import { createEmptyPitch, normalisePitch, type Horizon, type Pitch } from '../shared/pitch.js';

function pitchAt(id: string, title: string, createdAt: string, patch: Partial<Pitch> = {}): Pitch {
  return { ...createEmptyPitch(), id, title, createdAt, updatedAt: createdAt, problem: 'A recurring drag', stage: 'proposal', ...patch };
}

function betAt(id: string, title: string, createdAt: string, patch: Partial<Pitch> = {}): Pitch {
  return pitchAt(id, title, createdAt, {
    evidence: 'e', appetite: 'One focused week', constraints: 'c', solution: 's', risks: 'r',
    decision: 'bet', decisionRationale: 'd', stage: 'bet', appetiteBand: 'medium', confidence: 'high', horizon: 'now',
    github: {
      owner: 'demo', repo: 'sandbox', number: 7, url: `https://example.test/${id}`,
      title, body: '', state: 'open', updatedAt: createdAt, lastSyncedAt: createdAt,
    },
    ...patch,
  });
}

function workspace(): Pitch[] {
  const a = betAt('aaaa-1', 'Ship the map', '2026-01-02T00:00:00.000Z');
  const b = betAt('bbbb-2', 'Model "edges"', '2026-01-01T00:00:00.000Z', {
    horizon: 'next', github: undefined, dependencies: [{ pitchId: 'aaaa-1', reason: 'Map must exist first' }],
  });
  const c = pitchAt('cccc-3', 'A later hunch', '2026-01-03T00:00:00.000Z', { horizon: 'later', confidence: 'low' });
  const note = pitchAt('dddd-4', 'Just a note', '2026-01-01T00:00:00.000Z', { stage: 'note', problem: '' });
  return [a, b, c, note];
}

describe('export ordering', () => {
  it('orders by createdAt then id and excludes notes from the map', () => {
    const [x, y, z] = [pitchAt('b', 'B', '2026-01-01T00:00:00.000Z'), pitchAt('a', 'A', '2026-01-01T00:00:00.000Z'), pitchAt('c', 'C', '2025-12-31T00:00:00.000Z')];
    expect(orderForExport([x, y, z]).map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(mappablePitches(workspace()).map((p) => p.id)).toEqual(['bbbb-2', 'aaaa-1', 'cccc-3']);
  });
});

describe('mermaid export', () => {
  it('is deterministic: same input renders byte-identical output regardless of array order', () => {
    const pitches = workspace();
    const first = renderMermaidMap(pitches);
    expect(renderMermaidMap([...pitches].reverse())).toBe(first);
    expect(renderMermaidMap(JSON.parse(JSON.stringify(pitches)) as Pitch[])).toBe(first);
  });

  it('declares every edge endpoint as a node and follows basic flowchart grammar', () => {
    const output = renderMermaidMap(workspace());
    const lines = output.trimEnd().split('\n');
    expect(lines[0]).toBe('flowchart TD');
    const declared = new Set([...output.matchAll(/^ {4}([\w-]+)[[(]/gm)].map((match) => match[1]));
    expect(declared).toEqual(new Set(['aaaa-1', 'bbbb-2', 'cccc-3']));
    const edges = [...output.matchAll(/^ {2}([\w-]+) -->(?:\|"[^"\n]*"\|)? ([\w-]+)$/gm)];
    expect(edges).toHaveLength(1);
    for (const [, from, to] of edges) {
      expect(declared.has(from)).toBe(true);
      expect(declared.has(to)).toBe(true);
    }
    const subgraphs = output.match(/^ {2}subgraph /gm) ?? [];
    expect(subgraphs).toHaveLength(3);
    expect(output.match(/^ {2}end$/gm)).toHaveLength(subgraphs.length);
    for (const id of ['aaaa-1', 'bbbb-2', 'cccc-3']) expect(output).toMatch(new RegExp(`^ {2}class .*${id}`, 'm'));
  });

  it('escapes quotes, labels edges with reasons, and links only GitHub-linked bets', () => {
    const output = renderMermaidMap(workspace());
    expect(output).toContain('bbbb-2["Model #quot;edges#quot;"]');
    expect(output).toContain('cccc-3(["A later hunch"])');
    expect(output).toContain('aaaa-1 -->|"Map must exist first"| bbbb-2');
    expect(output).toContain('click aaaa-1 "https://example.test/aaaa-1" _blank');
    expect(output).not.toContain('click bbbb-2');
    expect(output).not.toContain('click cccc-3');
  });

  it('omits edges to deleted or note-stage pitches without crashing', () => {
    const pitches = workspace().filter((pitch) => pitch.id !== 'aaaa-1');
    const survivor = pitches.find((pitch) => pitch.id === 'bbbb-2') as Pitch;
    survivor.dependencies = [...(survivor.dependencies ?? []), { pitchId: 'dddd-4', reason: 'points at a note' }];
    const output = renderMermaidMap(pitches);
    expect(output).not.toContain('aaaa-1');
    expect(output).not.toContain('dddd-4');
    expect(output).not.toContain('-->');
    expect(renderMermaidMap(pitches)).toBe(output);
  });

  it('renders an explanatory empty map', () => {
    expect(renderMermaidMap([])).toBe('flowchart TD\n  %% No bets or proposals yet — the map fills as bets are made.\n');
  });
});

describe('markdown export', () => {
  it('is deterministic and stable across re-renders', () => {
    const pitches = workspace();
    const first = renderMarkdownMap(pitches);
    expect(renderMarkdownMap([...pitches].reverse())).toBe(first);
    expect(renderMarkdownMap(pitches)).toBe(first);
  });

  it('gives every pitch a section with stable block ids and Obsidian wiki links', () => {
    const output = renderMarkdownMap(workspace());
    expect(output.startsWith('# Bet map\n')).toBe(true);
    for (const heading of ['## Now', '## Next', '## Later']) expect(output).toContain(heading);
    for (const id of ['aaaa-1', 'bbbb-2', 'cccc-3']) expect(output).toContain(`Pitch \`${id}\` ^${id}`);
    expect(output).toContain('- Depends on [[#^aaaa-1|Ship the map]] — Map must exist first');
    expect(output).toContain('- GitHub: [demo/sandbox#7](https://example.test/aaaa-1)');
    expect(output).toContain('- Appetite: Medium batch — “One focused week”');
    expect(output).toContain('- Confidence: Low');
    expect(output).not.toContain('Just a note');
  });

  it('drops dangling dependency lines when the target pitch is deleted', () => {
    const pitches = workspace().filter((pitch) => pitch.id !== 'aaaa-1');
    const output = renderMarkdownMap(pitches);
    expect(output).not.toContain('Depends on');
    expect(output).not.toContain('aaaa-1');
  });

  it('sanitises wiki-link aliases so Obsidian links stay parseable', () => {
    const target = betAt('tttt-1', 'Weird [title] with | pipes ^and #hashes', '2026-01-01T00:00:00.000Z', { github: undefined });
    const dependent = betAt('uuuu-2', 'Depends on weird', '2026-01-02T00:00:00.000Z', { github: undefined, dependencies: [{ pitchId: 'tttt-1', reason: 'links must survive' }] });
    const output = renderMarkdownMap([target, dependent]);
    expect(output).toContain('[[#^tttt-1|Weird title with pipes and hashes]]');
    expect(output).not.toMatch(/\[\[[^\]]*[|][^|\]]*[|]/);
  });

  it('never invents committed dates', () => {
    const output = renderMarkdownMap(workspace());
    expect(output).not.toMatch(/\b2026-01-0\d/);
    expect(output).not.toMatch(/\bdue\b/i);
    expect(output).toContain('not committed delivery dates');
  });
});

describe('configurable horizons', () => {
  const quarters: Horizon[] = [
    { id: 'soon', label: 'Soon', hint: '' },
    { id: 'someday', label: 'Someday, maybe', hint: '' },
  ];

  it('groups both exports by the supplied horizon labels', () => {
    const pitches = [
      betAt('aaaa-1', 'Scheduled', '2026-01-01T00:00:00.000Z', { horizon: 'soon', github: undefined }),
      betAt('bbbb-2', 'Drifting', '2026-01-02T00:00:00.000Z', { horizon: 'now', github: undefined }),
    ];
    const mermaid = renderMermaidMap(pitches, quarters);
    expect(mermaid).toContain('subgraph h0["Soon"]');
    expect(mermaid).toContain('subgraph h1["Someday, maybe"]');
    expect(mermaid).not.toContain('"Now"');
    const markdown = renderMarkdownMap(pitches, quarters);
    expect(markdown).toContain('## Soon');
    expect(markdown.indexOf('Scheduled')).toBeLessThan(markdown.indexOf('Drifting'));
  });

  it('drops pitches with unknown horizons onto the furthest configured horizon', () => {
    const stray = betAt('cccc-3', 'Stray', '2026-01-01T00:00:00.000Z', { horizon: 'not-a-horizon', github: undefined });
    const markdown = renderMarkdownMap([stray], quarters);
    expect(markdown).toContain('## Someday, maybe');
    expect(markdown).not.toContain('## Soon');
  });
});

describe('legacy input', () => {
  it('exports normalised legacy pitches deterministically', () => {
    const { horizon: _h, dependencies: _d, ...legacy } = betAt('llll-1', 'From an old browser', '2026-01-01T00:00:00.000Z', { github: undefined });
    const revived = [normalisePitch(JSON.parse(JSON.stringify(legacy)) as Pitch)];
    const mermaid = renderMermaidMap(revived);
    expect(mermaid).toContain('subgraph h2["Later"]');
    expect(renderMermaidMap(revived)).toBe(mermaid);
    expect(renderMarkdownMap(revived)).toBe(renderMarkdownMap(revived));
  });
});
