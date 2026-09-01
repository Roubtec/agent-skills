// Read Markdown as LOGICAL lines, shared by the prose-pinning suites.
//
// SKILL.md prose is one sentence per line (AGENTS.md), so a clause that reads as
// one paragraph is spread over several lines. Read the file as LOGICAL lines — a
// line plus the continuation lines belonging to the same paragraph, joined with a
// space — so an anchor still selects the whole clause and the phrases pinned to it
// are tested against all of it. A list item starts a run of its own and never
// continues the run above it, which is what keeps neighbouring steps and bullets
// isolated the way matching raw lines used to; blank lines, headings, table rows,
// HTML comments and fences stand alone. There is no indented-code case: MD046 pins
// fenced style so the corpus has none, while a 4-space indent IS how a nested list
// item continues.
const TAB = String.fromCharCode(9);

const trimLeft = (line) => {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === TAB)) i++;
  return line.slice(i);
};

const withoutQuoteMarkers = (line) => {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === TAB || line[i] === '>')) i++;
  return line.slice(i);
};

function isListItem(line) {
  const t = trimLeft(line);
  if (t.startsWith('- ') || t.startsWith('* ') || t.startsWith('+ ')) return true;
  let i = 0;
  while (i < t.length && t[i] >= '0' && t[i] <= '9') i++;
  return i > 0 && (t[i] === '.' || t[i] === ')') && t[i + 1] === ' ';
}

function standsAlone(line) {
  if (withoutQuoteMarkers(line).trim() === '') return true;
  const t = trimLeft(line);
  return ['#', '|', '<!--', '```', '~~~'].some((opener) => t.startsWith(opener));
}

export function logicalLines(text) {
  const lines = text.split(String.fromCharCode(10));
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const t = trimLeft(lines[i]);
    const opener = t.startsWith('```') ? '`' : t.startsWith('~~~') ? '~' : null;
    if (opener) {
      fence = fence === opener ? null : fence || opener;
      out.push(lines[i]);
      continue;
    }
    if (fence || standsAlone(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    let joined = lines[i];
    while (i + 1 < lines.length && !standsAlone(lines[i + 1]) && !isListItem(lines[i + 1])) {
      joined += ' ' + lines[++i].trim();
    }
    out.push(joined);
  }
  return out;
}
