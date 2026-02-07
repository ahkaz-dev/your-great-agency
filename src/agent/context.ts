import type { PageSnapshot, DomNode } from '../browser/controller.js';

const MAX_PAGE_SUMMARY_CHARS = 3200;

const MODAL_HINT_KEYWORDS = [
  'close', 'dismiss', 'accept', 'agree', 'ok', 'allow', 'consent', 'cookie', 'cookies',
  'закрыть', 'принять', 'разрешить', 'согласен', 'понятно', 'ok', 'да', 'yes'
];

/**
 * Определяет, есть ли на странице модальное окно, попап или баннер (cookie/consent).
 * Возвращает подсказку для агента: сначала закрыть/принять, потом продолжать.
 */
export function getPageHints(snap: PageSnapshot): string {
  const hints: string[] = [];
  const hasDialog = snap.nodes.some(
    n => n.role === 'dialog' || n.role === 'alertdialog' || (n.role && String(n.role).toLowerCase().includes('dialog'))
  );
  const modalLikeText = snap.nodes.some(n => {
    const t = (n.text || '').toLowerCase() + (n.ariaLabel || '').toLowerCase();
    return MODAL_HINT_KEYWORDS.some(kw => t.includes(kw));
  });
  if (hasDialog) {
    hints.push('Page has role=dialog or alertdialog — treat as modal: close or accept it first (click Close, Accept, Dismiss, Agree).');
  }
  if (modalLikeText && (hasDialog || snap.nodes.some(n => /button|link/.test(n.tag) && (n.text || '').length < 50))) {
    if (!hints.length) hints.push('Overlay/cookie/consent likely (Close, Accept, Agree, Dismiss visible) — click to close or accept before other actions.');
  }
  return hints.join(' ');
}

/**
 * Строит компактное текстовое описание страницы для LLM в рамках лимита токенов.
 * Без хардкода селекторов — только семантика: тег, текст, роль, placeholder.
 */
export function pageSnapshotToSummary(snap: PageSnapshot, maxChars = MAX_PAGE_SUMMARY_CHARS): string {
  const lines: string[] = [];
  const hints = getPageHints(snap);
  if (hints) lines.push('Hints: ' + hints);
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
