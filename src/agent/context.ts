import type { PageSnapshot } from '../browser/controller.js';

const MAX_PAGE_SUMMARY_CHARS = 3200;

/**
 * Строит компактное описание страницы для LLM: только URL, title и элементы.
 * Без подсказок — агент сам понимает контекст из содержимого страницы.
 */
export function pageSnapshotToSummary(snap: PageSnapshot, maxChars = MAX_PAGE_SUMMARY_CHARS): string {
  const lines: string[] = [];
  lines.push(`URL: ${snap.url}`);
  lines.push(`Title: ${snap.title}`);
  lines.push('Elements (tag [type] role text placeholder aria):');

  for (const n of snap.nodes) {
    const parts: string[] = [n.tag];
    if (n.type && n.tag === 'input') parts.push(`[${n.type}]`);
    if (n.role) parts.push(`role=${n.role}`);
    if (n.text) parts.push(`"${n.text.slice(0, 60)}"`);
    if (n.placeholder) parts.push(`placeholder="${n.placeholder.slice(0, 40)}"`);
    if (n.ariaLabel) parts.push(`aria="${n.ariaLabel.slice(0, 40)}"`);
    if (n.name && n.tag === 'input') parts.push(`name=${n.name}`);
    const line = parts.join(' ');
    if (line.length > 120) lines.push(line.slice(0, 117) + '...');
    else lines.push(line);
  }

  const full = lines.join('\n');
  if (full.length <= maxChars) return full;
  return full.slice(0, maxChars - 50) + '\n... (truncated)';
}
