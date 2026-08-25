/**
 * Whole-app UI/UX audit.
 *
 * Walks every screen and opens every dialog, checking each for the defects
 * that do not throw and so never show up in a console: unreadable contrast,
 * controls with no accessible name, targets too small to hit, duplicate ids,
 * sideways page overflow, and inputs with no label.
 */
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2] || '.smoke-shots';
const THEME = process.argv[3] || 'light';

const CHECKS = `
(() => {
  // Tailwind v4 mixes colours in oklab, so getComputedStyle hands back
  // oklab(...) / color(...) strings whose numbers are not RGB channels at all.
  // Letting the browser paint the colour and reading the pixel back is the
  // only reading that is right for every colour space, alpha included.
  const _ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const _cache = new Map();
  const paint = (css, over) => {
    const key = css + '|' + over;
    if (_cache.has(key)) return _cache.get(key);
    _ctx.clearRect(0, 0, 1, 1);
    _ctx.fillStyle = over;          // what sits behind, so alpha composites correctly
    _ctx.fillRect(0, 0, 1, 1);
    _ctx.fillStyle = css;
    _ctx.fillRect(0, 0, 1, 1);
    const d = _ctx.getImageData(0, 0, 1, 1).data;
    const rgb = [d[0], d[1], d[2]];
    _cache.set(key, rgb);
    return rgb;
  };
  const pageBg = getComputedStyle(document.body).backgroundColor || '#fff';
  const parse = c => paint(c, pageBg);
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // Returns null when the backdrop is a gradient or image — those cannot be
  // reduced to one colour, and guessing produces false "white on white".
  const bgOf = el => {
    let n = el;
    while (n && n !== document.documentElement) {
      const st = getComputedStyle(n);
      if (st.backgroundImage && st.backgroundImage !== 'none') return null;
      const c = st.backgroundColor;
      if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return parse(c);
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  const ratio = (fg, bg) => {
    const L1 = lum(fg), L2 = lum(bg);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  };
  const visible = el => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };
  const name = el =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();

  const out = { contrast: [], unnamed: [], small: [], dupIds: [], overflow: null, unlabelled: [], noAlt: [] };
  const dedupe = (arr, keyFn) => {
    const m = new Map();
    for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, { ...x, count: 0 }); m.get(k).count++; }
    return [...m.values()].sort((a, b) => b.count - a.count);
  };

  // --- contrast ---
  for (const el of document.querySelectorAll('button,a,span,p,h1,h2,h3,h4,td,th,label,strong,div,li,option')) {
    const t = (el.textContent || '').trim();
    if (!t || t.length > 60 || el.children.length) continue;
    if (!visible(el)) continue;
    const st = getComputedStyle(el);
    const bg = bgOf(el);
    if (!bg) continue;                       // gradient backdrop — not measurable
    const r = ratio(parse(st.color), bg);
    const px = parseFloat(st.fontSize);
    const bold = parseInt(st.fontWeight, 10) >= 600;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (r < need) out.contrast.push({ t: t.slice(0, 40), r: +r.toFixed(2), need, px: Math.round(px), fg: st.color, bg: 'rgb(' + bg.join(',') + ')', sig: el.tagName + '|' + (el.className||'').toString().slice(0,70) });
  }

  // --- interactive elements with no accessible name ---
  for (const el of document.querySelectorAll('button,a[href],[role="button"],select')) {
    if (!visible(el)) continue;
    if (!name(el) && !el.querySelector('img[alt]:not([alt=""])')) {
      out.unnamed.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60) });
    }
  }

  // --- hit targets ---
  for (const el of document.querySelectorAll('button,a[href],[role="button"],input[type=checkbox],select')) {
    if (!visible(el)) continue;
    // A small checkbox inside a big clickable label is not a small target —
    // measure what the user can actually click.
    const wrap = el.closest('label,button') || el;
    const r = wrap.getBoundingClientRect();
    const min = Math.min(r.width, r.height);
    if (min < 28) out.small.push({ n: name(el).slice(0, 34) || el.tagName, w: Math.round(r.width), h: Math.round(r.height) });
  }

  // --- duplicate ids ---
  const ids = {};
  for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
  out.dupIds = Object.entries(ids).filter(([, n]) => n > 1).map(([id, n]) => id + ' x' + n);

  // --- sideways overflow ---
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2) out.overflow = { scroll: de.scrollWidth, client: de.clientWidth };

  // --- inputs without labels ---
  for (const el of document.querySelectorAll('input:not([type=hidden]),textarea,select')) {
    if (!visible(el)) continue;
    const id = el.id;
    const hasLabel = (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) || el.closest('label');
    if (!hasLabel && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.getAttribute('placeholder')) {
      out.unlabelled.push({ tag: el.tagName.toLowerCase(), id: id || '(no id)', cls: (el.className || '').toString().slice(0, 50) });
    }
  }

  // --- images without alt ---
  for (const el of document.querySelectorAll('img')) {
    if (!el.hasAttribute('alt')) out.noAlt.push(el.getAttribute('src') || '(no src)');
  }

  out.contrast   = dedupe(out.contrast,   x => x.sig);
  out.unnamed    = dedupe(out.unnamed,    x => x.tag + x.cls);
  out.small      = dedupe(out.small,      x => x.n + x.w + 'x' + x.h);
  out.unlabelled = dedupe(out.unlabelled, x => x.tag + x.cls);
  return out;
})()
`;

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

const clickText = async (page, text, scope = 'body') =>
  page.evaluate((t, sc) => {
    const root = document.querySelector(sc) || document.body;
    const b = [...root.querySelectorAll('button,[role="button"]')]
      .find(x => (x.textContent || '').trim().toLowerCase().includes(t.toLowerCase()));
    if (b) { b.click(); return true; }
    return false;
  }, text, scope);

const nav = async (page, label) => {
  let ok = await page.evaluate(t => {
    const b = [...document.querySelectorAll('header nav button')].find(x => x.textContent.trim().startsWith(t));
    if (b) { b.click(); return true; }
    return false;
  }, label);
  if (!ok) {
    await page.evaluate(() => {
      const g = [...document.querySelectorAll('header nav button')].find(x => /Settings/.test(x.textContent));
      if (g) g.click();
    });
    await new Promise(r => setTimeout(r, 400));
    ok = await page.evaluate(t => {
      const b = [...document.querySelectorAll('[role="menu"] button')].find(x => x.textContent.trim().startsWith(t));
      if (b) { b.click(); return true; }
      return false;
    }, label);
  }
  await new Promise(r => setTimeout(r, 2000));
  return ok;
};

const closeDialog = async page => {
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 400));
  const still = await page.evaluate(() => !!document.querySelector('[role="dialog"], .fixed.inset-0.z-50'));
  if (still) {
    await page.evaluate(() => {
      const x = [...document.querySelectorAll('button')].find(b =>
        /^(×|✕|✖|close|cancel)$/i.test((b.textContent || '').trim()) ||
        /close|cancel|dismiss/i.test(b.getAttribute('aria-label') || ''));
      if (x) x.click();
    });
    await new Promise(r => setTimeout(r, 400));
  }
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', m => m.type() === 'error' && consoleErrors.push('console: ' + m.text()));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(t => { try { localStorage.setItem('timely_theme', t); } catch (e) {} }, THEME);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  const results = {};
  const run = async label => {
    results[label] = await page.evaluate(CHECKS);
  };

  await run('Sign in');
  await signIn(page, 'Admin');
  await run('Today');

  for (const [label, screen] of [
    ['Customers', 'Customers'],
    ['PDC cheques', 'PDC cheques'],
    ['Reports', 'Reports'],
    ['Team & access', 'Team & access'],
    ['Message templates', 'Message templates'],
    ['Data source', 'Data source'],
  ]) {
    const ok = await nav(page, screen);
    if (!ok) { results[label] = 'NAV NOT FOUND'; continue; }
    await run(label);
  }

  // ---- dialogs ----
  const dialogs = [
    ['Add customer dialog', 'Customers', 'Add Customer'],
    ['Record cheque dialog', 'PDC cheques', 'Add PDC'],
    ['Add user dialog', 'Team & access', 'Add User'],
    ['Template dialog', 'Message templates', 'New Template'],
  ];
  for (const [label, screen, trigger] of dialogs) {
    await nav(page, screen);
    const opened = await clickText(page, trigger);
    await new Promise(r => setTimeout(r, 1000));
    const isOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"], .fixed.inset-0.z-50'));
    if (!opened || !isOpen) { results[label] = 'COULD NOT OPEN (' + trigger + ')'; continue; }
    await run(label);
    await page.screenshot({ path: `${OUT}/dlg-${label.replace(/\W+/g, '-')}.png` });
    await closeDialog(page);
  }

  await browser.close();

  // ---------------- report ----------------
  let total = 0;
  console.log(`\n=========== UI AUDIT (${THEME} theme) ===========\n`);
  for (const [screen, r] of Object.entries(results)) {
    if (typeof r === 'string') { console.log(`${screen}: ${r}\n`); continue; }
    const counts = [
      r.contrast.length && `${r.contrast.length} contrast`,
      r.unnamed.length && `${r.unnamed.length} unnamed`,
      r.small.length && `${r.small.length} small-target`,
      r.dupIds.length && `${r.dupIds.length} dup-id`,
      r.unlabelled.length && `${r.unlabelled.length} unlabelled`,
      r.noAlt.length && `${r.noAlt.length} no-alt`,
      r.overflow && 'overflow',
    ].filter(Boolean);
    total += r.contrast.length + r.unnamed.length + r.small.length + r.dupIds.length + r.unlabelled.length + r.noAlt.length + (r.overflow ? 1 : 0);
    console.log(`--- ${screen} --- ${counts.length ? counts.join(', ') : 'clean'}`);
    r.contrast.slice(0, 8).forEach(c => console.log(`    contrast ${String(c.r).padEnd(5)} need ${c.need}  ${c.px}px  x${c.count}  fg ${c.fg} on ${c.bg}  "${c.t}"`));
    r.unnamed.slice(0, 6).forEach(u => console.log(`    unnamed  <${u.tag}> ${u.cls}`));
    r.small.slice(0, 8).forEach(s => console.log(`    target   ${s.w}x${s.h}  x${s.count}  "${s.n}"`));
    r.dupIds.slice(0, 6).forEach(d => console.log(`    dup id   ${d}`));
    r.unlabelled.slice(0, 6).forEach(u => console.log(`    no label <${u.tag}> x${u.count} ${u.cls}`));
    if (r.overflow) console.log(`    overflow page scrolls sideways ${r.overflow.scroll} > ${r.overflow.client}`);
    console.log('');
  }
  console.log(`console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 10).forEach(e => console.log('    ' + e));
  console.log(`\nTOTAL ISSUES: ${total}`);
})().catch(e => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
