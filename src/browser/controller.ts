import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';

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

function safeText(s: string | null | undefined) {
  if (!s) return undefined;
  return s.replace(/\s+/g, ' ').trim();
}

export async function createBrowserController() {
  console.log('Launching browser...');
  const browser: Browser = await chromium.launch({ 
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  
  const ctx = await browser.newContext({ 
    viewport: { width: 1280, height: 800 },
    javaScriptEnabled: true,
    acceptDownloads: false
  });
  
  const page: Page = await ctx.newPage();
  
  // Set default timeout
  page.setDefaultTimeout(10000);

  async function navigate(url: string) {
    console.log(`Navigating to: ${url}`);
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      console.log(`Successfully loaded: ${page.url()}`);
    } catch (error) {
      console.error(`Navigation failed: ${error}`);
      throw error;
    }
  }

  async function getSnapshot(): Promise<PageSnapshot> {
    try {
      const url = page.url();
      const title = await page.title();
      
      // Limit DOM evaluation for better performance
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
          return !!rect && rect.width > 5 && rect.height > 5 && 
                 st.visibility !== 'hidden' && st.display !== 'none';
        }
        
        // Focus on interactive elements only for better performance
        const interactiveElements = Array.from(
          document.querySelectorAll(
            'a, button, input, textarea, select, [role], *[onclick], *[tabindex], label'
          )
        ) as HTMLElement[];
        
        return interactiveElements
          .slice(0, 400) // Reduced for performance
          .filter(el => visible(el))
          .map(el => {
            const rect = el.getBoundingClientRect();
            const role = el.getAttribute('role');
            const id = el.id || null;
            const classes = Array.from(el.classList || []).slice(0, 5); // Limit classes
            const href = (el as HTMLAnchorElement).href || null;
            const name = (el as any).name || null;
            const ariaLabel = el.getAttribute('aria-label');
            const placeholder = (el as any).placeholder || null;
            const type = (el as any).type || null;
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
            
            return {
              tag: el.tagName.toLowerCase(),
              text,
              role,
              id,
              classes,
              href,
              name,
              ariaLabel,
              placeholder,
              type,
              visible: true, // Already filtered
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              xpath: toXPath(el),
            };
          });
      });
      
      return { url, title, nodes };
    } catch (error) {
      console.error(`Failed to get snapshot: ${error}`);
      throw error;
    }
  }

  async function click(xpath: string) {
    try {
      const locator = page.locator(`xpath=${xpath}`).first();
      await locator.click({ 
        timeout: 5000,
        force: true // Override invisible elements if needed
      });
    } catch (error) {
      console.error(`Click failed for xpath ${xpath}: ${error}`);
      throw error;
    }
  }

  async function type(xpath: string, text: string, pressEnter?: boolean) {
    try {
      const loc = page.locator(`xpath=${xpath}`).first();
      await loc.fill('');
      await loc.type(text, { delay: 0 }); // Faster typing
      if (pressEnter) await loc.press('Enter');
    } catch (error) {
      console.error(`Type failed for xpath ${xpath}: ${error}`);
      throw error;
    }
  }

  async function setValue(xpath: string, text: string) {
    try {
      const loc = page.locator(`xpath=${xpath}`).first();
      await loc.fill(text);
    } catch (error) {
      console.error(`SetValue failed for xpath ${xpath}: ${error}`);
      throw error;
    }
  }

  async function waitIdle() {
    try {
      await Promise.race([
        page.waitForLoadState('networkidle', { timeout: 5000 }),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    } catch {
      // Ignore timeout, continue execution
    }
  }

  async function dispose() {
    try {
      await page.close();
      await browser.close();
      console.log('Browser closed successfully');
    } catch (error) {
      console.error(`Error during cleanup: ${error}`);
    }
  }

  async function scroll(pixels = 800) {
    try {
      await page.evaluate((y) => {
        window.scrollBy(0, y);
      }, pixels);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll
    } catch (error) {
      console.error(`Scroll failed: ${error}`);
    }
  }

  return { navigate, getSnapshot, click, type, setValue, waitIdle, dispose, scroll };
}
