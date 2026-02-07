import type { DomNode } from '../browser/controller.js';

export type Candidate = { node: DomNode; score: number };

function normalize(s?: string | null) {
  return (s || '').toLowerCase();
}

export function scoreNode(node: DomNode, intent: string): number {
  if (node.tag === 'input' && node.type === 'submit') {
    return -Infinity;
  }

  // HARD FILTER: ignore navigation/header elements
  if (node.tag === 'nav') return -Infinity;
  if (node.xpath?.includes('/header')) return -Infinity;
  if (node.xpath?.includes('/nav')) return -Infinity;
  let score = 0;
  if (!node.visible) return -Infinity;
  const text = normalize(node.text);
  const aria = normalize(node.ariaLabel);
  const placeholder = normalize(node.placeholder);
  const id = normalize(node.id || undefined);
  const classes = (node.classes || []).map(c => c.toLowerCase());
  const intentWords = intent.toLowerCase().split(/[^a-zа-я0-9]+/i).filter(Boolean);

  // Heuristic semantic matches
  const keywords = new Set([ ...intentWords ]);
  const synonyms: Record<string, string[]> = {
    search: ['search', 'find', 'go', 'submit', 'lookup'],
    login: ['login', 'sign in', 'sign-in', 'enter', 'submit'],
    next: ['next', 'continue', 'proceed', 'more'],
    add: ['add', 'buy', 'cart', 'basket', 'order'],
  };
  for (const [k, arr] of Object.entries(synonyms)) {
    if (intent.includes(k)) arr.forEach(x => keywords.add(x));
  }

  const fields = [text, aria, placeholder, id, classes.join(' ')].join(' ');
  for (const w of keywords) if (fields.includes(w)) score += 3;

  // Role weight
  if (node.role) {
    if (['button', 'link', 'textbox', 'searchbox', 'combobox', 'menuitem'].includes(node.role)) score += 2;
  }
  if (node.tag === 'a' || node.tag === 'button' || node.tag === 'input') score += 1.5;

  // Position: prefer visible in upper-middle area
  if (node.rect) {
    const y = node.rect.y;
    if (y >= 0 && y < 600) score += 0.5;
  }

  return score;
}

export function pickCandidates(nodes: DomNode[], intent: string, limit = 10): Candidate[] {
  const scored = nodes.map(n => ({ node: n, score: scoreNode(n, intent) }))
    .filter(c => isFinite(c.score))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
