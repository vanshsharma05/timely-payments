/** READ-ONLY accessibility + consistency sweep of the main screens and dialogs; every write aborted.
 *  node scripts/tests/a11y-sweep.cjs <outDir> [baseUrl] [width] [height]
 *  Reports, per screen: horizontal overflow, text under WCAG AA contrast, controls without an accessible name,
 *  running animations, button-style variety; per dialog: role/aria-modal, whether Tab escapes, whether Esc closes. */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2]; const BASE = process.argv[3] || 'http://localhost:3000';
const W = Number(process.argv[4] || 1366), H = Number(process.argv[5] || 768);

const SWEEP = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const parse = (c) => { if (!c || c === 'transparent') return null; cx.clearRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const blend = (fg, bg) => [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));
  const bgOf = (el) => { let n = el; let acc = null; while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { if (c[3] >= 1) return acc ? blend(acc, c) : c; acc = acc ? blend(acc, c) : c; } n = n.parentElement; } const root = [255, 255, 255]; return acc ? blend(acc, root) : root; };
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const scope = document.querySelector('[role="dialog"], [role="alertdialog"], .fixed.inset-0') || document.body;
  // low-contrast text: leaf elements with their own text
  const low = [];
  for (const el of scope.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (!text || text.length < 2) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); if (!fg) continue;
    const fgB = fg[3] < 1 ? blend(fg, bgOf(el)) : fg;
    const r = ratio(fgB, bgOf(el));
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (r < need) low.push({ text: text.slice(0, 40), ratio: Math.round(r * 100) / 100, size, cls: (el.className && String(el.className).slice(0, 80)) || el.tagName, need });
  }
  // controls without an accessible name
  const nameOf = (el) => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby')) && document.getElementById(el.getAttribute('aria-labelledby')).textContent) || el.getAttribute('title') || (el.id && document.querySelector('label[for="' + el.id + '"]') && document.querySelector('label[for="' + el.id + '"]').textContent) || (el.closest('label') && el.closest('label').textContent) || el.getAttribute('placeholder') || el.textContent || '').trim();
  const unnamed = [];
  for (const el of scope.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]')) {
    if (!visible(el)) continue;
    if (!nameOf(el)) unnamed.push({ tag: el.tagName, type: el.getAttribute('type') || '', cls: String(el.className).slice(0, 70) });
  }
  // button style variety (consistency metric)
  const styles = new Map();
  for (const b of scope.querySelectorAll('button')) { if (!visible(b)) continue; const cs = getComputedStyle(b); const k = [cs.backgroundColor, cs.borderRadius, Math.round(b.getBoundingClientRect().height), cs.fontSize].join('|'); styles.set(k, (styles.get(k) || 0) + 1); }
  // headings order
  const heads = [...scope.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => h.tagName + ':' + h.textContent.trim().slice(0, 30));
  // images without alt
  const noAlt = [...scope.querySelectorAll('img')].filter((i) => visible(i) && !i.hasAttribute('alt')).length;
  // running animations
  const anims = document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : -1;
  return { low: low.sort((a, b) => a.ratio - b.ratio).slice(0, 12), lowCount: low.length, unnamed: unnamed.slice(0, 10), unnamedCount: unnamed.length, buttonStyles: styles.size, buttons: [...styles.values()].reduce((a, b) => a + b, 0), heads: heads.slice(0, 8), noAlt, anims, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: W, height: H, isMobile: W < 500, hasTouch: W < 500 });
  await page.setRequestInterception(true);
  page.on('request', (req) => { const m = req.method(); const url = req.url(); if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && (/\/rest\/v1\//.test(url) || /\/api\/(team|daily-report|gemini-report)/.test(url))) return req.abort('blockedbyclient'); req.continue(); });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
  await signIn(page); await wait(2000);
  const report = {};
  const sweep = async (name) => { const r = await page.evaluate(SWEEP); report[name] = r; console.log(`\n== ${name}: overflow ${r.overflow}px · low-contrast ${r.lowCount} · unnamed ${r.unnamedCount} · button styles ${r.buttonStyles}/${r.buttons} · anims ${r.anims} · noAlt ${r.noAlt}`); r.low.slice(0, 6).forEach((l) => console.log(`   ${l.ratio} (need ${l.need}) "${l.text}" ${l.size}px [${l.cls}]`)); r.unnamed.slice(0, 5).forEach((u) => console.log(`   unnamed ${u.tag} ${u.type} [${u.cls}]`)); console.log('   heads:', r.heads.join(' · ')); };
  const trap = async (name) => {
    // Tab 40 times from inside the dialog; focus must stay inside; Esc must close
    const r = await page.evaluate(async () => {
      const d = document.querySelector('[role="dialog"], [role="alertdialog"], .fixed.inset-0'); if (!d) return null;
      const f = d.querySelector('button, [href], input, select, textarea'); f && f.focus();
      return { has: true, hasRole: !!d.closest('[role="dialog"], [role="alertdialog"]') || d.getAttribute('role') === 'dialog' || !!d.querySelector('[role="dialog"], [role="alertdialog"]'), modal: !!d.querySelector('[aria-modal="true"]') || d.getAttribute('aria-modal') === 'true' };
    });
    if (!r) { console.log(`   ${name}: no dialog`); return; }
    let escaped = 0;
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const inside = await page.evaluate(() => { const d = document.querySelector('[role="dialog"], [role="alertdialog"], .fixed.inset-0'); return !!d && d.contains(document.activeElement); }); if (!inside) escaped++; }
    await page.keyboard.press('Escape'); await wait(400);
    const closed = await page.evaluate(() => !document.querySelector('[role="dialog"], [role="alertdialog"], .fixed.inset-0'));
    console.log(`   ${name}: role=${r.hasRole} aria-modal=${r.modal} focus left the dialog ${escaped}/40 tabs · Esc closed: ${closed}`);
    report[name + ':trap'] = { ...r, escaped, closed };
    if (!closed) { await page.evaluate(() => { const b = document.querySelector('[aria-label="Close"], button[title^="Close"]'); b && b.click(); }); await wait(300); }
  };
  const go = async (hash) => { await page.goto(BASE + '/#' + hash, { waitUntil: 'networkidle2' }); await wait(1800); };
  const click = (re) => page.evaluate((src, flags) => { const r = new RegExp(src, flags); const b = [...document.querySelectorAll('button, a')].find((x) => [x.getAttribute('aria-label') || '', x.getAttribute('title') || '', x.textContent || ''].some((t) => r.test(t.trim()))); if (!b) return false; b.click(); return true; }, re.source, re.flags);
  const type = (sel, v) => page.evaluate((s, val) => { const i = document.querySelector(s); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, val); i.dispatchEvent(new Event('input', { bubbles: true })); return true; }, sel, v);

  await go('overview'); await sweep('Today');
  await go('customers'); await sweep('Customers');
  await type('input[placeholder^="Search by name"]', 'BROTHERS'); await wait(800);
  const rowBtn = (re) => page.evaluate((src, flags) => { const r = new RegExp(src, flags); const b = [...document.querySelectorAll('tbody tr button')].find((x) => [x.getAttribute('aria-label') || '', x.getAttribute('title') || '', x.textContent || ''].some((t) => r.test(t.trim()))); if (!b) return false; b.click(); return true; }, re.source, re.flags);
  console.log('  open follow-up:', await rowBtn(/^Follow up$/)); await wait(1200); await sweep('Follow-up dialog'); await trap('Follow-up dialog');
  console.log('  open edit:', await rowBtn(/^Edit/)); await wait(900); await sweep('Edit dialog'); await trap('Edit dialog');
  console.log('  open whatsapp:', await rowBtn(/whatsapp/i)); await wait(900); await sweep('WhatsApp dialog'); await trap('WhatsApp dialog');
  await type('input[placeholder^="Search by name"]', ''); await wait(300);
  console.log('  open add:', await click(/^Add customer$/)); await wait(900); await sweep('Add customer dialog'); await trap('Add customer dialog');
  // the questions asked before something irreversible: in the app, focus on Cancel, Esc backs out (nothing is written)
  console.log('  ask delete customer:', await rowBtn(/^Delete customer$/)); await wait(600); await sweep('Delete customer question'); await trap('Delete customer question');
  await go('pdc'); await sweep('Cheques');
  await click(/Record a cheque/); await wait(800); await sweep('Record cheque dialog'); await trap('Record cheque dialog');
  await go('reports'); await sweep('Reports');
  console.log('  open ai:', await click(/^AI summary$/)); await wait(2500); await sweep('AI report dialog'); await trap('AI report dialog');
  await go('stock'); await wait(3000); await sweep('Live stock');
  await go('source'); await sweep('Data source');
  await go('users'); await sweep('Team & access');
  await click(/Add a team member|Add User/); await wait(900); await sweep('Add user dialog'); await trap('Add user dialog');
  console.log('  ask remove member:', await click(/^Remove /)); await wait(600); await sweep('Remove member question'); await trap('Remove member question');
  console.log('  company tab:', await click(/^Company profile$/)); await wait(600); await sweep('Company profile');
  await go('templates'); await sweep('Templates');
  await click(/^New template$/); await wait(900); await sweep('Template dialog'); await trap('Template dialog');
  console.log('  ask delete template:', await click(/^Delete template /)); await wait(600); await sweep('Delete template question'); await trap('Delete template question');
  await go('alerts'); await sweep('Alerts');
  fs.writeFileSync(`${OUT}/a11y-${W}.json`, JSON.stringify({ report, errors }, null, 1));
  console.log('\npage errors:', errors.slice(0, 5));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
