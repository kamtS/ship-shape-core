import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const viewports = [
  { name: 'narrow-320', width: 320, height: 568 },
  { name: 'mobile-375', width: 375, height: 667 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 640 },
  { name: 'desktop-constrained', width: 1280, height: 640 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const repositories = Array.from({ length: 6 }, (_, index) => `
  <button data-control="repository-${index + 1}">
    <span aria-hidden="true">◇</span><span><strong>repository-${index + 1}</strong><small>sample-owner · ${index % 2 ? 'private' : 'public'}</small></span><span aria-hidden="true">→</span>
  </button>`).join('');

const drafts = Array.from({ length: 4 }, (_, index) => `
  <button class="pitch-row" data-control="draft-${index + 1}">
    <span class="pitch-title">Draft opportunity ${index + 1}</span><span class="pitch-meta">Captured · recently</span>
  </button>`).join('');

function fixture(styles: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${styles.replace(/^@import[^;]+;/, '')}
    .fixture-main { min-height: 1200px; }
    .repository-rail { flex: none; min-width: 0; }
    .rail-account { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 18px; }
    .rail-account > div { min-width: 0; }
    .rail-account strong, .rail-account small { display: block; }
    .rail-account button { width: 44px; min-height: 44px; }
    .repository-list { display: flex; flex-direction: column; gap: 5px; }
    .repository-list > button { width: 100%; min-height: 49px; display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 8px 9px; }
    .repository-list strong, .repository-list small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .permission-note { margin: 12px 0 0; min-height: 82px; padding: 10px; border: 1px solid #c5cfb1; border-radius: 10px; }
    .permission-note strong { display: block; }
    .opportunity-heading { margin-top: 17px; padding-top: 16px; border-top: 1px solid var(--line); }
  </style></head><body>
    <div class="app-shell">
      <header class="topbar"><button class="brand">Ship Shape</button><span class="topbar-message">Shape the work.</span><span class="mode-pill">Connected</span></header>
      <nav class="product-nav"><div class="product-nav-inner"><button>Portfolio</button><button>Repository board</button><button>Shape a bet</button></div></nav>
      <div class="workspace">
        <aside class="sidebar" aria-label="Workspace sidebar">
          <section class="repository-rail sidebar-section" data-section="repositories">
            <div class="rail-account"><div><small>GitHub connection</small><strong>@sample-user</strong></div><button data-control="sign-out" aria-label="Sign out">↪</button></div>
            <div class="side-heading"><span>Connected repositories</span></div>
            <div class="repository-list">${repositories}</div>
            <div class="permission-note" data-section="permission"><strong>Repository access</strong><span>Selection limits writes. Every write still needs preview and confirmation.</span></div>
          </section>
          <section class="sidebar-section" data-section="drafts">
            <div class="side-heading opportunity-heading"><span>Local shaping drafts</span><button class="icon-button" data-control="add-draft" aria-label="Capture opportunity">+</button></div>
            <div class="pitch-list">${drafts}</div>
          </section>
          <div class="sidebar-note" data-section="note"><p><strong>Not a project board.</strong><br>Local drafts help you decide. Issues record the bets you make.</p></div>
        </aside>
        <main class="fixture-main"></main>
      </div>
    </div>
  </body></html>`;
}

describe('content-rich responsive sidebar', () => {
  const browserAvailable = existsSync(chromium.executablePath());
  let browser: Browser | undefined;
  let styles: string;

  beforeAll(async () => {
    styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
    if (browserAvailable) browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('declares one scroll surface with normal-flow sections', () => {
    expect(styles).toMatch(/\.sidebar \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden;/s);
    expect(styles).toMatch(/\.sidebar-section \{ flex: none; min-width: 0; \}/);
    expect(styles).toMatch(/\.sidebar-note \{[^}]*flex: none;[^}]*margin-top: 16px;/s);
    expect(styles).toMatch(/@media \(max-width: 800px\)[\s\S]*\.sidebar[^}]*overflow: visible;/);
    expect(repositories.match(/data-control="repository-/g)).toHaveLength(6);
    expect(drafts.match(/data-control="draft-/g)).toHaveLength(4);
  });

  for (const viewport of viewports) {
    it.runIf(browserAvailable)(`keeps every section reachable without overlap at ${viewport.name}`, async () => {
      const page = await browser!.newPage({ viewport });
      await page.setContent(fixture(styles), { waitUntil: 'domcontentloaded' });
      if (process.env.SIDEBAR_SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.SIDEBAR_SCREENSHOTS}/${viewport.name}-top.png` });
      }

      const layout = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
        const sections = [...sidebar.querySelectorAll<HTMLElement>(':scope > [data-section]')];
        const rectangles = sections.map((section) => ({
          name: section.dataset.section,
          top: section.getBoundingClientRect().top,
          bottom: section.getBoundingClientRect().bottom,
        }));
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          sidebarClientHeight: sidebar.clientHeight,
          sidebarScrollHeight: sidebar.scrollHeight,
          rectangles,
          permissionBottom: document.querySelector<HTMLElement>('[data-section="permission"]')!.getBoundingClientRect().bottom,
          draftsTop: document.querySelector<HTMLElement>('[data-section="drafts"]')!.getBoundingClientRect().top,
        };
      });

      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      for (let index = 1; index < layout.rectangles.length; index += 1) {
        expect(layout.rectangles[index].top).toBeGreaterThanOrEqual(layout.rectangles[index - 1].bottom - 1);
      }
      expect(layout.draftsTop).toBeGreaterThanOrEqual(layout.permissionBottom - 1);

      const sidebar = page.locator('.sidebar');
      const note = page.locator('[data-section="note"]');
      if (viewport.width > 800) {
        if (viewport.height <= 640) expect(layout.sidebarScrollHeight).toBeGreaterThan(layout.sidebarClientHeight);
        await sidebar.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        const visible = await page.evaluate(() => {
          const container = document.querySelector<HTMLElement>('.sidebar')!.getBoundingClientRect();
          const target = document.querySelector<HTMLElement>('[data-section="note"]')!.getBoundingClientRect();
          return target.top >= container.top - 1 && target.bottom <= container.bottom + 1;
        });
        expect(visible).toBe(true);
      } else {
        expect(await sidebar.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');
        await note.scrollIntoViewIfNeeded();
        const visible = await note.evaluate((element) => {
          const target = element.getBoundingClientRect();
          return target.top >= -1 && target.bottom <= window.innerHeight + 1;
        });
        expect(visible).toBe(true);
      }

      if (process.env.SIDEBAR_SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.SIDEBAR_SCREENSHOTS}/${viewport.name}-reachable.png` });
      }

      await page.close();
    });
  }

  it.runIf(browserAvailable)('keeps narrow controls touch-sized and keyboard ordered', async () => {
    const page = await browser!.newPage({ viewport: { width: 320, height: 568 } });
    await page.setContent(fixture(styles), { waitUntil: 'domcontentloaded' });
    const controls = page.locator('[data-control]');
    expect(await controls.count()).toBe(12);

    for (let index = 0; index < await controls.count(); index += 1) {
      expect((await controls.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }

    await controls.first().focus();
    for (let index = 1; index < await controls.count(); index += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-control'))).toBe(await controls.nth(index).getAttribute('data-control'));
    }
    expect(await controls.last().evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.close();
  });
});
