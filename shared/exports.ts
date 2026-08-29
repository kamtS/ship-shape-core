import {
  APPETITE_BAND_LABELS,
  DEFAULT_HORIZONS,
  horizonOf,
  ladderStage,
  resolvableDependencies,
  type Horizon,
  type Pitch,
} from './pitch.js';

// Pure, deterministic exports of the bet map. The ordering rule is pinned:
// createdAt then id. The same pitch set must always produce byte-identical
// output, so nothing here reads the clock, locale, or any other ambient state.

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

function mermaidLabel(text: string): string {
  return oneLine(text).replace(/"/g, '#quot;');
}

export function renderMermaidMap(pitches: Pitch[], horizons: Horizon[] = DEFAULT_HORIZONS): string {
  const mapped = mappablePitches(pitches);
  const lines = ['flowchart TD'];
  if (!mapped.length) {
    lines.push('  %% No bets or proposals yet — the map fills as bets are made.');
    return `${lines.join('\n')}\n`;
  }
  horizons.forEach((horizon, index) => {
    const members = mapped.filter((pitch) => horizonOf(pitch, horizons) === horizon.id);
    if (!members.length) return;
    lines.push(`  subgraph h${index}["${mermaidLabel(horizon.label)}"]`);
    for (const pitch of members) {
      const label = mermaidLabel(displayTitle(pitch));
      lines.push(ladderStage(pitch) === 'bet' ? `    ${pitch.id}["${label}"]` : `    ${pitch.id}(["${label}"])`);
    }
    lines.push('  end');
  });
  for (const pitch of mapped) {
    for (const edge of resolvableDependencies(pitch, mapped)) {
      const reason = mermaidLabel(edge.reason);
      lines.push(reason ? `  ${edge.pitchId} -->|"${reason}"| ${pitch.id}` : `  ${edge.pitchId} --> ${pitch.id}`);
    }
  }
  for (const pitch of mapped) {
    if (pitch.github) lines.push(`  click ${pitch.id} "${pitch.github.url}" _blank`);
  }
  lines.push('  classDef bet fill:#596340,color:#ffffff,stroke:#3f472c');
  lines.push('  classDef proposal fill:#f0f3e8,color:#24251f,stroke:#9faf73,stroke-dasharray:4 3');
  const bets = mapped.filter((pitch) => ladderStage(pitch) === 'bet');
  const proposals = mapped.filter((pitch) => ladderStage(pitch) !== 'bet');
  if (bets.length) lines.push(`  class ${bets.map((pitch) => pitch.id).join(',')} bet`);
  if (proposals.length) lines.push(`  class ${proposals.map((pitch) => pitch.id).join(',')} proposal`);
  return `${lines.join('\n')}\n`;
}

function wikiAlias(text: string): string {
  return oneLine(text.replace(/[[\]|#^]/g, '')) || 'Untitled note';
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function renderMarkdownMap(pitches: Pitch[], horizons: Horizon[] = DEFAULT_HORIZONS): string {
  const mapped = mappablePitches(pitches);
  const byId = new Map(mapped.map((pitch) => [pitch.id, pitch]));
  const blocks: string[] = [
    '# Bet map',
    'Horizons describe intent, not committed delivery dates. Exported from Ship Shape; GitHub Issues remain the canonical record for linked bets.',
  ];
  if (!mapped.length) {
    blocks.push('_No bets or proposals yet — the map fills as bets are made._');
    return `${blocks.join('\n\n')}\n`;
  }
  for (const horizon of horizons) {
    const members = mapped.filter((pitch) => horizonOf(pitch, horizons) === horizon.id);
    if (!members.length) continue;
    blocks.push(`## ${oneLine(horizon.label)}`);
    for (const pitch of members) {
      const facts = [`- Stage: ${titleCase(ladderStage(pitch))}`];
      const appetiteText = oneLine(pitch.appetite);
      const band = pitch.appetiteBand ? APPETITE_BAND_LABELS[pitch.appetiteBand] : '';
      facts.push(`- Appetite: ${[band, appetiteText && `“${appetiteText}”`].filter(Boolean).join(' — ') || 'Not set'}`);
      facts.push(`- Confidence: ${pitch.confidence ? titleCase(pitch.confidence) : 'Not set'}`);
      if (pitch.github) facts.push(`- GitHub: [${pitch.github.owner}/${pitch.github.repo}#${pitch.github.number}](${pitch.github.url})`);
      for (const edge of resolvableDependencies(pitch, mapped)) {
        const target = byId.get(edge.pitchId) as Pitch;
        const reason = oneLine(edge.reason);
        facts.push(`- Depends on [[#^${target.id}|${wikiAlias(displayTitle(target))}]]${reason ? ` — ${reason}` : ''}`);
      }
      const section = [`### ${oneLine(displayTitle(pitch))}`, facts.join('\n')];
      const problem = oneLine(pitch.problem);
      if (problem) section.push(problem);
      section.push(`Pitch \`${pitch.id}\` ^${pitch.id}`);
      blocks.push(section.join('\n\n'));
    }
  }
  return `${blocks.join('\n\n')}\n`;
}
