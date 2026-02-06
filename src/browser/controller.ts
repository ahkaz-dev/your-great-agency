import { chromium,  } from 'playwright';
import type { Browser, Page} from 'playwright';


export type DomNode = {
  tag: string;
  text?: string;
  role?: string | null;
  id?: string | null;
  classes?: string[];
  href?: string | null;
  name?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  type?: string | null;
  visible?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  xpath: string;
};

export type PageSnapshot = {
  url: string;
  title: string;
  nodes: DomNode[];
};

export function safeText(s: string | null | undefined) {
  if (!s) return undefined;
  return s.replace(/\s+/g, ' ').trim();
}

export async function createBrowserController() {
  const browser: Browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page: Page = await ctx.newPage();

  async function navigate(url: string) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async function getSnapshot(): Promise<PageSnapshot> {
    const url = page.url();
    const title = await page.title();
    const nodes: DomNode[] = await page.evaluate(() => {
      function toXPath(element: Element): string {
        if (element === document.body) return '/html/body';
        const ix = Array.from(element.parentNode?.childNodes || [])
          .filter((sib: any) => sib.nodeName === element.nodeName)
          .indexOf(element) + 1;
        return `${toXPath(element.parentElement!)}//${element.tagName.toLowerCase()}[${ix}]`;
      }
      function visible(el: Element) {
        const st = window.getComputedStyle(el);
        const rect = (el as HTMLElement).getBoundingClientRect?.();
        return !!rect && rect.width > 2 && rect.height > 2 && st.visibility !== 'hidden' && st.display !== 'none';
      }
      const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],*[onclick]')) as HTMLElement[];
      return elements.slice(0, 800).map(el => {
        const rect = el.getBoundingClientRect();
        const role = el.getAttribute('role');
        const id = el.id || null;
        const classes = Array.from(el.classList || []);
        const href = (el as HTMLAnchorElement).href || null;
        const name = (el as any).name || null;
        const ariaLabel = el.getAttribute('aria-label');
        const placeholder = (el as any).placeholder || null;
        const type = (el as any).type || null;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          tag: el.tagName.toLowerCase(),
          text, role, id, classes, href, name, ariaLabel, placeholder, type,
          visible: visible(el),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          xpath: toXPath(el),
        };
      });
    });
    return { url, title, nodes };
  }

  async function click(xpath: string) {
    await page.locator(`xpath=${xpath}`).first().click({ timeout: 3000 });
  }

  async function type(xpath: string, text: string, pressEnter?: boolean) {
    const loc = page.locator(`xpath=${xpath}`).first();
    await loc.fill('');
    await loc.type(text, { delay: 10 });
    if (pressEnter) await loc.press('Enter');
  }

  async function setValue(xpath: string, text: string) {
    const loc = page.locator(`xpath=${xpath}`).first();
    await loc.fill(text);
  }

  async function waitIdle() {
    await page.waitForLoadState('networkidle', { timeout: 9000 }).catch(() => {});
  }

  async function dispose() {
    await page.close();
    await browser.close();
  }

    async function scroll(pixels = 1000) {
    await page.evaluate((y) => {
      window.scrollBy(0, y);
    }, pixels);
  }

  

  return { navigate, getSnapshot, click, type, setValue, waitIdle, dispose, scroll };
}
