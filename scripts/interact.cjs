/**
 * Functional sweep: clicks things and checks they actually do something.
 * Catches the class of bug an accessibility audit cannot — a menu that opens
 * but is clipped out of sight, a control that throws, a dialog that will not
 * close, a brand accent that silently fails to paint.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const signIn = async (page, name) => {
  await page.evaluate(n => {
    const b = [...document.querySelectorAll('button')].find(x =>
      [...x.querySelectorAll('span')].some(s => s.textContent.trim() === n));
    if (b) b.click();
  }, name);
  await new Promise(r => setTimeout(r, 700));
  await page.waitForSelector('input#pw', { timeout: 8000 });
  await page.type('input#pw', name === 'Admin' ? 'admin' : 'password123');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 3500));
};

const clickByText = (page, text, sel = 'button') =>
  page.evaluate((t, s) => {
    const b = [...document.querySelectorAll(s)]
      .find(x => (x.textContent || '').trim().toLowerCase().includes(t.toLowerCase()));
    if (b) { b.click(); return true; }
    return false;
  }, text, sel);

const dialogOpen = page =>
  page.evaluate(() => !!document.querySelector('[role="dialog"], .fixed.inset-0.z-50'));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));

  const out = [];
  const check = (name, pass, detail) => out.push({ name, pass, ...(detail ? { detail } : {}) });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  /* ---- brand accents actually paint ---- */
  const loginBrand = await page.evaluate(() => {
    const card = document.querySelector('.rounded-\\[28px\\]');
    if (!card) return null;
    const st = getComputedStyle(card);
    return { borderTop: st.borderTopWidth + ' ' + st.borderTopStyle + ' ' + st.borderTopColor };
  });
  check('login card brand rule', !!loginBrand && !/0px|none/.test(loginBrand.borderTop), loginBrand?.borderTop);

  const logoOk = await page.evaluate(() => {
    const i = document.querySelector('img[alt="Shori Chemicals"]');
    return i ? { complete: i.complete, w: i.naturalWidth } : null;
  });
  check('login logo loads', !!logoOk && logoOk.complete && logoOk.w > 0, JSON.stringify(logoOk));

  await signIn(page, 'Admin');

  const headerBrand = await page.evaluate(() => {
    const h = document.querySelector('header');
    const st = getComputedStyle(h);
    const mark = document.querySelector('header img');
    return {
      border: st.borderBottomWidth + ' ' + st.borderBottomColor,
      markLoaded: mark ? mark.complete && mark.naturalWidth > 0 : false,
    };
  });
  check('header brand rule', !/^0px/.test(headerBrand.border), headerBrand.border);
  check('header mark loads', headerBrand.markLoaded);

  /* ---- Settings menu opens AND is reachable ---- */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('header nav button')].find(x => /Settings/.test(x.textContent));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 400));
  const menu = await page.evaluate(() => {
    const m = document.querySelector('[role="menu"]');
    if (!m) return { open: false };
    const r = m.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 20));
    return { open: true, reachable: !!(hit && (m === hit || m.contains(hit))), items: m.querySelectorAll('button').length };
  });
  check('settings menu reachable', menu.open && menu.reachable, JSON.stringify(menu));

  /* every settings destination actually navigates */
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));
  for (const label of ['Team & access', 'Message templates', 'Data source']) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('header nav button')].find(x => /Settings/.test(x.textContent));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 350));
    const clicked = await page.evaluate(t => {
      const b = [...document.querySelectorAll('[role="menu"] button')].find(x => x.textContent.trim().startsWith(t));
      if (b) { b.click(); return true; }
      return false;
    }, label);
    await new Promise(r => setTimeout(r, 1500));
    const title = await page.evaluate(() => document.querySelector('h1')?.textContent || '');
    check(`settings -> ${label}`, clicked && title.length > 0, title);
  }

  /* ---- primary tabs ---- */
  for (const label of ['Today', 'Customers', 'PDC cheques', 'Reports']) {
    const ok = await page.evaluate(t => {
      const b = [...document.querySelectorAll('header nav button')].find(x => x.textContent.trim().startsWith(t));
      if (b) { b.click(); return true; }
      return false;
    }, label);
    await new Promise(r => setTimeout(r, 1600));
    const title = await page.evaluate(() => document.querySelector('h1')?.textContent || '');
    check(`tab -> ${label}`, ok && !!title, title);
  }

  /* ---- dialogs open and close ---- */
  const dialogs = [
    ['Customers', 'Add Customer'],
    ['PDC cheques', 'Add PDC'],
  ];
  for (const [tab, trigger] of dialogs) {
    await page.evaluate(t => {
      const b = [...document.querySelectorAll('header nav button')].find(x => x.textContent.trim().startsWith(t));
      if (b) b.click();
    }, tab);
    await new Promise(r => setTimeout(r, 1500));
    const opened = await clickByText(page, trigger);
    await new Promise(r => setTimeout(r, 900));
    const isOpen = await dialogOpen(page);
    check(`dialog opens: ${trigger}`, opened && isOpen);

    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
    let stillOpen = await dialogOpen(page);
    if (stillOpen) {
      await page.evaluate(() => {
        const x = [...document.querySelectorAll('button')].find(b => /close|cancel/i.test(b.getAttribute('aria-label') || b.textContent || ''));
        if (x) x.click();
      });
      await new Promise(r => setTimeout(r, 500));
      stillOpen = await dialogOpen(page);
    }
    check(`dialog closes: ${trigger}`, !stillOpen);
  }

  /* ---- theme toggle ---- */
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('header button')].find(x => /mode/i.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 600));
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('theme toggle', before !== after, `${before} -> ${after}`);

  /* ---- search filters the table ---- */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('header nav button')].find(x => x.textContent.trim().startsWith('Customers'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 1600));
  const rowsBefore = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
  await page.click('header input[aria-label="Search"]');
  await page.type('header input[aria-label="Search"]', 'ASHWANI');
  await new Promise(r => setTimeout(r, 1400));
  const rowsAfter = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
  check('search narrows the list', rowsAfter > 0 && rowsAfter < rowsBefore, `${rowsBefore} -> ${rowsAfter}`);

  await browser.close();

  const fail = out.filter(o => !o.pass);
  out.forEach(o => console.log(`  ${o.pass ? 'PASS' : 'FAIL'}  ${o.name}${o.detail ? '   [' + o.detail + ']' : ''}`));
  console.log(`\n${out.length - fail.length}/${out.length} passed`);
  console.log('console errors:', errors.length);
  errors.slice(0, 6).forEach(e => console.log('  ' + e));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
