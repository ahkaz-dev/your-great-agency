import type { PageSnapshot, createBrowserController } from '../browser/controller.js';
import { pickCandidates } from './selectors.js';

type BrowserController = Awaited<ReturnType<typeof createBrowserController>>;

export type ToolEvent = { type: string; message?: string; data?: any };

export function createTools(browser: BrowserController) {
  return {
    navigate: async (url: string) => {
      await browser.navigate(url);
      await browser.waitIdle();
      return { ok: true };
    },
    observe: async () => {
      return browser.getSnapshot();
    },
    click_by_intent: async (intent: string) => {
      const snap = await browser.getSnapshot();
      const candidates = pickCandidates(snap.nodes, intent, 8);
      if (!candidates.length) throw new Error('No candidates to click');

      const best = candidates.find(c =>
        !c.node.xpath.includes('/header') &&
        !c.node.xpath.includes('/nav')
      );

      if (!best) throw new Error('No safe candidates to click');

      await browser.click(best.node.xpath);
      await browser.waitIdle();
      return { clicked: best.node.xpath, title: snap.title };
    },
    type_by_intent: async (intent: string, text: string, pressEnter?: boolean) => {
      const snap = await browser.getSnapshot();
      const candidates = pickCandidates(snap.nodes.filter(n =>
          (n.tag === 'input' && n.type !== 'submit') ||
          n.tag === 'textarea' ||
          n.role === 'searchbox'
        ), intent, 8);
      if (!candidates.length) throw new Error('No candidates to type');
      await browser.type(candidates[0].node.xpath, text, pressEnter);
      await browser.waitIdle();
      return { typed: candidates[0].node.xpath };
    },
    scroll: async (pixels?: number) => {
      await browser.scroll(pixels ?? 800);
      await browser.waitIdle();
      return { scrolled: pixels ?? 800 };
    },
  };
}
