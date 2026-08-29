import {
  annotatedDependencies,
  APPETITE_BAND_LABELS,
  appetiteBandOf,
  confidenceOf,
  DEFAULT_HORIZONS,
  effectiveHorizons,
  horizonOf,
  ladderStage,
  type AnnotatedDependency,
  type Horizon,
  type Pitch,
} from './pitch.js';

// Pure, deterministic exports of the bet map. The ordering rules are pinned:
// pitches by createdAt then id, edges canonically by target id then reason.
// The same pitch set must always produce byte-identical output, so nothing
// here reads the clock, locale, or any other ambient state. All interpolated
// text is context-escaped: pitch fields come from persisted client data and
// must not be able to inject Mermaid statements, Markdown/HTML, or URLs.

export function orderForExport(pitches: Pitch[]): Pitch[] {
  return [...pitches].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// The map and both exports cover proposals and bets; notes stay in the inbox.
export function mappablePitches(pitches: Pitch[]): Pitch[] {
  return orderForExport(pitches.filter((pitch) => ladderStage(pitch) !== 'note'));
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function displayTitle(pitch: Pitch): string {
  return oneLine(pitch.title) || 'Untitled note';
}

// Accepts only well-formed http(s) URLs with a real hostname, and none of the
// characters that could break out of the quoted/parenthesised link contexts.
function safeHttpUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return /[\s"<>\\]/.test(url) ? null : url;
}

// --- Mermaid ---------------------------------------------------------------

// Escape order matters: '#' first (entities introduce new '#'s of our own),
// then the characters Mermaid or its HTML labels would otherwise interpret —
// including backticks and emphasis markers, which Mermaid's markdown-string
// syntax would render as formatting instead of text.
function mermaidLabel(text: string): string {
  return oneLine(text)
    .replace(/#/g, '#35;')
    .replace(/&/g, '#38;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/"/g, '#quot;')
    .replace(/`/g, '#96;')
    .replace(/\*/g, '#42;')
    .replace(/_/g, '#95;')
    .replace(/~/g, '#126;');
}

function commentSafe(text: string): string {
  return oneLine(text).replace(/%%/g, '%');
}

export function renderMermaidMap(pitches: Pitch[], horizons: Horizon[] = DEFAULT_HORIZONS): string {
  const usableHorizons = effectiveHorizons(horizons);
  const mapped = mappablePitches(pitches);
  const lines = ['flowchart TD'];
  if (!mapped.length) {
    lines.push('  %% No bets or proposals yet — the map fills as bets are made.');
    return `${lines.join('\n')}\n`;
  }
  // Node identifiers are synthetic (n1, n2, …) so arbitrary stored ids cannot
  // corrupt the grammar; the comment block pins each one to its pitch UUID.
  const nodeIds = new Map(mapped.map((pitch, index) => [pitch.id, `n${index + 1}`]));
  for (const pitch of mapped) lines.push(`  %% ${nodeIds.get(pitch.id)} = pitch ${commentSafe(pitch.id)}`);
  const annotated = new Map(mapped.map((pitch) => [pitch.id, annotatedDependencies(pitch, pitches)]));
  usableHorizons.forEach((horizon, index) => {
    const members = mapped.filter((pitch) => horizonOf(pitch, usableHorizons) === horizon.id);
    if (!members.length) return;
    lines.push(`  subgraph h${index}["${mermaidLabel(horizon.label)}"]`);
    for (const pitch of members) {
      const unresolved = (annotated.get(pitch.id) ?? []).filter((edge) => edge.status !== 'ok').length;
      const label = mermaidLabel(displayTitle(pitch)) + (unresolved ? ` ⚠ ${unresolved} unresolved ${unresolved === 1 ? 'dependency' : 'dependencies'}` : '');
      lines.push(ladderStage(pitch) === 'bet' ? `    ${nodeIds.get(pitch.id)}["${label}"]` : `    ${nodeIds.get(pitch.id)}(["${label}"])`);
    }
    lines.push('  end');
  });
  for (const pitch of mapped) {
    for (const edge of annotated.get(pitch.id) ?? []) {
      if (edge.status !== 'ok') {
        const named = edge.target ? `"${commentSafe(displayTitle(edge.target))}" (still a note)` : 'a pitch no longer in this workspace';
        lines.push(`  %% unresolved: ${nodeIds.get(pitch.id)} depends on ${named}${edge.reason.trim() ? ` — ${commentSafe(edge.reason)}` : ''}`);
        continue;
      }
      const reason = mermaidLabel(edge.reason);
      const from = nodeIds.get(edge.pitchId);
      lines.push(reason ? `  ${from} -->|"${reason}"| ${nodeIds.get(pitch.id)}` : `  ${from} --> ${nodeIds.get(pitch.id)}`);
    }
  }
  for (const pitch of mapped) {
    const url = pitch.github && safeHttpUrl(pitch.github.url);
    if (url) lines.push(`  click ${nodeIds.get(pitch.id)} "${url}" _blank`);
  }
  lines.push('  classDef bet fill:#596340,color:#ffffff,stroke:#3f472c');
  lines.push('  classDef proposal fill:#f0f3e8,color:#24251f,stroke:#9faf73,stroke-dasharray:4 3');
  const bets = mapped.filter((pitch) => ladderStage(pitch) === 'bet');
  const proposals = mapped.filter((pitch) => ladderStage(pitch) !== 'bet');
  if (bets.length) lines.push(`  class ${bets.map((pitch) => nodeIds.get(pitch.id)).join(',')} bet`);
  if (proposals.length) lines.push(`  class ${proposals.map((pitch) => nodeIds.get(pitch.id)).join(',')} proposal`);
  return `${lines.join('\n')}\n`;
}

// --- Markdown --------------------------------------------------------------

// Backslash-escape everything that can open a Markdown or HTML construct.
// CommonMark renders a backslash-escaped punctuation character literally.
// Tildes are escaped for ~~strikethrough~~; the trailing replaces neutralise
// block syntax when the text starts a paragraph — thematic breaks ('---'),
// list items ('- x', '+ x', '1. x'), quotes, and setext underlines.
function markdownText(text: string): string {
  return oneLine(text)
    .replace(/([\\`*_[\]<>|&#!~])/g, '\\$1')
    .replace(/^(\d+)([.)])/, '$1\\$2')
    .replace(/^([-+=.])/, '\\$1');
}

// Obsidian block ids and code spans cannot carry arbitrary characters, so
// anchors are reduced to their safe alphabet. UI-created UUIDs pass through
// unchanged.
function blockAnchor(id: string): string {
  return id.replace(/[^A-Za-z0-9-]/g, '') || 'unidentified';
}

// Wiki-link aliases cannot use backslash escapes reliably, so characters that
// would break the link or open an HTML construct are stripped instead.
function wikiAlias(text: string): string {
  return oneLine(text.replace(/[[\]|#^<>`]/g, '')) || 'Untitled note';
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dependencyFact(edge: AnnotatedDependency): string {
  const reason = edge.reason.trim() ? ` — ${markdownText(edge.reason)}` : '';
  if (edge.status === 'missing') return `- Depends on a pitch no longer in this workspace${reason}`;
  if (edge.status === 'note') return `- Depends on ${markdownText(displayTitle(edge.target as Pitch))} (still a note — not on this map)${reason}`;
  const target = edge.target as Pitch;
  return `- Depends on [[#^${blockAnchor(target.id)}|${wikiAlias(displayTitle(target))}]]${reason}`;
}

export function renderMarkdownMap(pitches: Pitch[], horizons: Horizon[] = DEFAULT_HORIZONS): string {
  const usableHorizons = effectiveHorizons(horizons);
  const mapped = mappablePitches(pitches);
  const blocks: string[] = [
    '# Bet map',
    'Horizons describe intent, not committed delivery dates. Exported from Ship Shape; GitHub Issues remain the canonical record for linked bets.',
  ];
  if (!mapped.length) {
    blocks.push('_No bets or proposals yet — the map fills as bets are made._');
    return `${blocks.join('\n\n')}\n`;
  }
  for (const horizon of usableHorizons) {
    const members = mapped.filter((pitch) => horizonOf(pitch, usableHorizons) === horizon.id);
    if (!members.length) continue;
    blocks.push(`## ${markdownText(horizon.label)}`);
    for (const pitch of members) {
      const facts = [`- Stage: ${titleCase(ladderStage(pitch))}`];
      const appetiteText = markdownText(pitch.appetite);
      const knownBand = appetiteBandOf(pitch);
      const band = knownBand ? APPETITE_BAND_LABELS[knownBand] : markdownText(pitch.appetiteBand ?? '');
      facts.push(`- Appetite: ${[band, appetiteText && `“${appetiteText}”`].filter(Boolean).join(' — ') || 'Not set'}`);
      const confidence = confidenceOf(pitch);
      facts.push(`- Confidence: ${confidence ? titleCase(confidence) : markdownText(pitch.confidence ?? '') || 'Not set'}`);
      const url = pitch.github && safeHttpUrl(pitch.github.url);
      if (pitch.github) {
        const issueName = markdownText(`${pitch.github.owner}/${pitch.github.repo}#${pitch.github.number}`);
        facts.push(url ? `- GitHub: [${issueName}](${url.replace(/[()]/g, (char) => (char === '(' ? '%28' : '%29'))})` : `- GitHub: ${issueName} (link withheld — stored URL is not a plain http(s) URL)`);
      }
      for (const edge of annotatedDependencies(pitch, pitches)) facts.push(dependencyFact(edge));
      const section = [`### ${markdownText(displayTitle(pitch))}`, facts.join('\n')];
      const problem = markdownText(pitch.problem);
      if (problem) section.push(problem);
      section.push(`Pitch \`${blockAnchor(pitch.id)}\` ^${blockAnchor(pitch.id)}`);
      blocks.push(section.join('\n\n'));
    }
  }
  return `${blocks.join('\n\n')}\n`;
}
