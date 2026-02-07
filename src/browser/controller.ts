import { chromium } from 'playwright-extra';
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

  // Стартовая страница: загрузка и подсказка пользователю
  const loadingHtml = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Агент запущен</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e8e8e8;
      padding: 2rem;
      text-align: center;
    }
    .loader { font-size: 1.5rem; margin-bottom: 1.5rem; }
    .message { font-size: 1.1rem; opacity: 0.9; max-width: 420px; line-height: 1.5; }
    .hint { margin-top: 2rem; font-size: 0.9rem; opacity: 0.7; }
  </style>
</head>
<body>
  <div class="loader">⏳ Загрузка...</div>
  <p class="message">Агент анализирует задачу и ищет пути решения. Скоро здесь откроется нужная страница.</p>
  <p class="hint">Не закрывайте это окно — управление браузером выполняет агент.</p>
</body>
</html>`;
  await page.setContent(loadingHtml, { waitUntil: 'domcontentloaded' });

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

      // Скрипт передаём строкой, чтобы в браузер не попадали артефакты сборки (__name и т.д.)
      const nodes: DomNode[] = await page.evaluate(`
        (function() {
          function toXPath(element) {
            if (element === document.body) return '/html/body';
            var parent = element.parentElement;
            if (!parent) return '/html/body';
            var siblings = Array.prototype.filter.call(parent.childNodes, function(s) { return s.nodeName === element.nodeName; });
            var ix = siblings.indexOf(element) + 1;
            return toXPath(parent) + '//' + element.tagName.toLowerCase() + '[' + ix + ']';
          }
          function visible(el) {
            var st = window.getComputedStyle(el);
            var rect = el.getBoundingClientRect && el.getBoundingClientRect();
            return rect && rect.width > 5 && rect.height > 5 && st.visibility !== 'hidden' && st.display !== 'none';
          }
          var interactive = document.querySelectorAll('a, button, input, textarea, select, [role], *[onclick], *[tabindex], label');
          var list = [];
          var max = Math.min(400, interactive.length);
          for (var i = 0; i < max; i++) {
            var el = interactive[i];
            if (!visible(el)) continue;
            var rect = el.getBoundingClientRect();
            var text = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100);
            var classes = [];
            if (el.classList) for (var k = 0; k < Math.min(5, el.classList.length); k++) classes.push(el.classList[k]);
            list.push({
              tag: el.tagName.toLowerCase(),
              text: text,
              role: el.getAttribute('role'),
              id: el.id || null,
              classes: classes,
              href: el.href || null,
              name: el.name || null,
              ariaLabel: el.getAttribute('aria-label'),
              placeholder: el.placeholder || null,
              type: el.type || null,
              visible: true,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              xpath: toXPath(el)
            });
          }
          return list;
        })()
      `);

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
      await page.evaluate('window.scrollBy(0, ' + pixels + ')');
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Scroll failed: ${error}`);
    }
  }

  return { navigate, getSnapshot, click, type, setValue, waitIdle, dispose, scroll };
}
