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

// Export order is createdAt then id: bbbb-2 (01-01) → n1, aaaa-1 (01-02) → n2,
// cccc-3 (01-03) → n3. The note is not mapped and gets no node.
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

  it('is invariant under dependency-edge permutation and collapses duplicates', () => {
    const edges = [
      { pitchId: 'aaaa-1', reason: 'map first' },
      { pitchId: 'cccc-3', reason: 'hunch first' },
      { pitchId: 'aaaa-1', reason: 'map first' },
    ];
    const build = (order: typeof edges) => {
      const pitches = workspace();
      (pitches.find((p) => p.id === 'bbbb-2') as Pitch).dependencies = order;
      return pitches;
    };
    const first = renderMermaidMap(build(edges));
    expect(renderMermaidMap(build([...edges].reverse()))).toBe(first);
    expect(renderMarkdownMap(build([...edges].reverse()))).toBe(renderMarkdownMap(build(edges)));
    expect(first.match(/n2 -->\|"map first"\| n1/g)).toHaveLength(1);
  });

  it('uses synthetic node ids, maps them to pitch UUIDs, and follows flowchart grammar', () => {
    const output = renderMermaidMap(workspace());
    const lines = output.trimEnd().split('\n');
    expect(lines[0]).toBe('flowchart TD');
    expect(output).toContain('%% n1 = pitch bbbb-2');
    expect(output).toContain('%% n2 = pitch aaaa-1');
    expect(output).toContain('%% n3 = pitch cccc-3');
    const declared = new Set([...output.matchAll(/^ {4}(n\d+)[[(]/gm)].map((match) => match[1]));
    expect(declared).toEqual(new Set(['n1', 'n2', 'n3']));
    const edges = [...output.matchAll(/^ {2}(n\d+) -->(?:\|"[^"\n]*"\|)? (n\d+)$/gm)];
    expect(edges).toHaveLength(1);
    for (const [, from, to] of edges) {
      expect(declared.has(from)).toBe(true);
      expect(declared.has(to)).toBe(true);
    }
    const subgraphs = output.match(/^ {2}subgraph /gm) ?? [];
    expect(subgraphs).toHaveLength(3);
    expect(output.match(/^ {2}end$/gm)).toHaveLength(subgraphs.length);
    for (const id of ['n1', 'n2', 'n3']) expect(output).toMatch(new RegExp(`^ {2}class .*${id}`, 'm'));
  });

  it('escapes labels, labels edges with reasons, and links only GitHub-linked bets', () => {
    const output = renderMermaidMap(workspace());
    expect(output).toContain('n1["Model #quot;edges#quot;"]');
    expect(output).toContain('n3(["A later hunch"])');
    expect(output).toContain('n2 -->|"Map must exist first"| n1');
    expect(output).toContain('click n2 "https://example.test/aaaa-1" _blank');
    expect(output.match(/^ {2}click /gm)).toHaveLength(1);
  });

  it('escapes adversarial titles and reasons instead of letting them close the grammar', () => {
    const evil = betAt('eeee-1', 'Break"] --> out & <b>bold</b> #x', '2026-01-01T00:00:00.000Z', { github: undefined });
    const dependent = betAt('ffff-2', 'Dependent', '2026-01-02T00:00:00.000Z', {
      github: undefined, dependencies: [{ pitchId: 'eeee-1', reason: 'needs "quotes" | pipes\nand lines' }],
    });
    const markdownish = betAt('gggg-3', '`**bold**` _em_ ~~del~~', '2026-01-03T00:00:00.000Z', { github: undefined });
    const output = renderMermaidMap([evil, dependent, markdownish]);
    expect(output).toContain('n1["Break#quot;] --#gt; out #38; #lt;b#gt;bold#lt;/b#gt; #35;x"]');
    expect(output).toContain('n3["#96;#42;#42;bold#42;#42;#96; #95;em#95; #126;#126;del#126;#126;"]');
    expect(output).toContain('n1 -->|"needs #quot;quotes#quot; | pipes and lines"| n2');
    // After removing our own entity escapes, no markup metacharacter may
    // survive inside any quoted label.
    for (const quoted of output.match(/"[^"\n]*"/g) ?? []) {
      expect(quoted.replace(/#(35|38|96|42|95|126);|#quot;|#lt;|#gt;/g, '')).not.toMatch(/[`*_~<>&#\\]/);
    }
    expect(renderMermaidMap([evil, dependent, markdownish])).toBe(output);
  });

  it('withholds click directives for malformed or non-http(s) snapshot URLs', () => {
    for (const url of ['javascript:alert(1)', 'https://?', 'https://', 'ftp://example.test/x', 'not a url', 'https://bad"quote.test/x']) {
      const tampered = betAt('aaaa-1', 'Tampered', '2026-01-01T00:00:00.000Z');
      (tampered.github as { url: string }).url = url;
      const output = renderMermaidMap([tampered]);
      expect(output).not.toContain('click');
      expect(output).not.toContain('javascript:');
    }
    const sound = betAt('aaaa-1', 'Sound', '2026-01-01T00:00:00.000Z');
    expect(renderMermaidMap([sound])).toContain('click n1 "https://example.test/aaaa-1" _blank');
  });

  it('surfaces deleted and note-demoted dependency targets instead of hiding them', () => {
    const pitches = workspace().filter((pitch) => pitch.id !== 'aaaa-1');
    const survivor = pitches.find((pitch) => pitch.id === 'bbbb-2') as Pitch;
    survivor.dependencies = [...(survivor.dependencies ?? []), { pitchId: 'dddd-4', reason: 'points at a note' }];
    const output = renderMermaidMap(pitches);
    expect(output).not.toContain('aaaa-1');
    expect(output).not.toContain('dddd-4');
    expect(output).not.toContain('-->');
    expect(output).toContain('⚠ 2 unresolved dependencies');
    expect(output).toContain('%% unresolved: n1 depends on a pitch no longer in this workspace — Map must exist first');
    expect(output).toContain('%% unresolved: n1 depends on "Just a note" (still a note) — points at a note');
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
    expect(output).toContain('- GitHub: [demo/sandbox\\#7](https://example.test/aaaa-1)');
    expect(output).toContain('- Appetite: Medium batch — “One focused week”');
    expect(output).toContain('- Confidence: Low');
    expect(output).not.toContain('Just a note');
  });

  it('escapes markdown metacharacters in titles, reasons, and problems', () => {
    const evil = betAt('eeee-1', 'Sneaky [link](https://evil.test) <script>alert(1)</script>', '2026-01-01T00:00:00.000Z', {
      github: undefined, problem: 'Inline `code` and *emphasis* and <!-- comments -->',
    });
    const dependent = betAt('ffff-2', 'Dependent', '2026-01-02T00:00:00.000Z', {
      github: undefined, dependencies: [{ pitchId: 'eeee-1', reason: 'because ![img](x) | tables' }],
    });
    const output = renderMarkdownMap([evil, dependent]);
    expect(output).toContain('### Sneaky \\[link\\](https://evil.test) \\<script\\>alert(1)\\</script\\>');
    expect(output).toContain('Inline \\`code\\` and \\*emphasis\\* and \\<\\!-- comments --\\>');
    expect(output).toContain('— because \\!\\[img\\](x) \\| tables');
    expect(output).not.toMatch(/[^\\]<script>/);
    expect(renderMarkdownMap([evil, dependent])).toBe(output);
  });

  it('neutralises block-level markdown in interpolated content', () => {
    const evil = betAt('eeee-1', '1. Numbered start', '2026-01-01T00:00:00.000Z', {
      github: undefined, problem: '--- not a thematic break', appetite: '+ not a list item',
    });
    const other = betAt('ffff-2', '- dashed title', '2026-01-02T00:00:00.000Z', {
      github: undefined, problem: '~~struck~~ still here', dependencies: [{ pitchId: 'eeee-1', reason: '> not a quote' }],
    });
    const output = renderMarkdownMap([evil, other]);
    expect(output).toContain('### 1\\. Numbered start');
    expect(output).toContain('\\--- not a thematic break');
    expect(output).toContain('“\\+ not a list item”');
    expect(output).toContain('### \\- dashed title');
    expect(output).toContain('\\~\\~struck\\~\\~ still here');
    expect(output).toContain('— \\> not a quote');
    expect(output).not.toMatch(/^---/m);
    expect(renderMarkdownMap([evil, other])).toBe(output);
  });

  it('withholds GitHub links for malformed or non-http(s) snapshot URLs', () => {
    for (const url of ['javascript:alert(1)', 'https://?', 'https://', 'ftp://example.test/x', 'not a url']) {
      const tampered = betAt('aaaa-1', 'Tampered', '2026-01-01T00:00:00.000Z');
      (tampered.github as { url: string }).url = url;
      const output = renderMarkdownMap([tampered]);
      expect(output).toContain('- GitHub: demo/sandbox\\#7 (link withheld — stored URL is not a plain http(s) URL)');
      expect(output).not.toContain('](');
    }
  });

  it('sanitises wiki-link aliases so Obsidian links stay parseable', () => {
    const target = betAt('tttt-1', 'Weird [title] with | pipes ^and #hashes', '2026-01-01T00:00:00.000Z', { github: undefined });
    const dependent = betAt('uuuu-2', 'Depends on weird', '2026-01-02T00:00:00.000Z', { github: undefined, dependencies: [{ pitchId: 'tttt-1', reason: 'links must survive' }] });
    const output = renderMarkdownMap([target, dependent]);
    expect(output).toContain('[[#^tttt-1|Weird title with pipes and hashes]]');
    expect(output).not.toMatch(/\[\[[^\]]*[|][^|\]]*[|]/);
  });

  it('keeps deleted and note-demoted dependencies visible with explicit annotations', () => {
    const pitches = workspace().filter((pitch) => pitch.id !== 'aaaa-1');
    const survivor = pitches.find((pitch) => pitch.id === 'bbbb-2') as Pitch;
    survivor.dependencies = [...(survivor.dependencies ?? []), { pitchId: 'dddd-4', reason: 'points at a note' }];
    const output = renderMarkdownMap(pitches);
    expect(output).toContain('- Depends on a pitch no longer in this workspace — Map must exist first');
    expect(output).toContain('- Depends on Just a note (still a note — not on this map) — points at a note');
    expect(output).not.toContain('aaaa-1');
    expect(output).not.toContain('[[#^dddd-4');
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

  it('treats an empty horizon configuration as the built-in defaults', () => {
    const pitches = [betAt('aaaa-1', 'Somewhere', '2026-01-01T00:00:00.000Z', { github: undefined })];
    const mermaid = renderMermaidMap(pitches, []);
    expect(mermaid).toContain('subgraph h0["Now"]');
    expect(mermaid).toBe(renderMermaidMap(pitches));
    expect(renderMarkdownMap(pitches, [])).toBe(renderMarkdownMap(pitches));
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
