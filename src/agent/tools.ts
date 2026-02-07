import { createBrowserController } from '../browser/controller.ts';
import type { PageSnapshot } from '../browser/controller.ts';
import { pickCandidates } from './selectors.ts';

export type ToolEvent = { type: string; message?: string; data?: any };

export function createTools(browser: ReturnType<typeof createBrowserController>) {
  async function snapshot(): Promise<PageSnapshot> { return await (await browser).getSnapshot(); }

  return {
    navigate: async (url: string) => {
      await (await browser).navigate(url);
      await (await browser).waitIdle();
      return { ok: true };
    },
    observe: async () => {
      const snap = await (await browser).getSnapshot();
      return snap;
    },
    click_by_intent: async (intent: string) => {
      const snap = await (await browser).getSnapshot();
      const candidates = pickCandidates(snap.nodes, intent, 8);
      if (!candidates.length) throw new Error('No candidates to click');

      const best = candidates.find(c =>
        !c.node.xpath.includes('/header') &&
        !c.node.xpath.includes('/nav')
      );

      if (!best) throw new Error('No safe candidates to click');

      await (await browser).click(best.node.xpath);
      
      await (await browser).waitIdle();
      return { clicked: candidates[0].node.xpath, title: snap.title };
    },
    type_by_intent: async (intent: string, text: string, pressEnter?: boolean) => {
      const snap = await (await browser).getSnapshot();
      const candidates = pickCandidates(snap.nodes.filter(n =>
          (n.tag === 'input' && n.type !== 'submit') ||
          n.tag === 'textarea' ||
          n.role === 'searchbox'
        ), intent, 8);
      if (!candidates.length) throw new Error('No candidates to type');
      await (await browser).type(candidates[0].node.xpath, text, pressEnter);
      await (await browser).waitIdle();
      return { typed: candidates[0].node.xpath };
    },
    scroll: async (pixels?: number) => {
      await (await browser).scroll(pixels ?? 800);
      await (await browser).waitIdle();
      return { scrolled: pixels ?? 800 };
    },
  };
  
}
