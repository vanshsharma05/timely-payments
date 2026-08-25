const puppeteer = require('puppeteer-core');

  const signIn = async (page, name) => {
    await page.evaluate(n => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(x => [...x.querySelectorAll('span')].some(s => s.textContent.trim() === n));
      if (b) b.click();
    }, name);
    await new Promise(r => setTimeout(r, 800));
    await page.waitForSelector('input#pw', { timeout: 8000 });
    await page.type('input#pw', name === 'Admin' ? 'admin' : 'password123');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 3500));
  };

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => { try { localStorage.setItem('timely_theme', 'dark'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  await signIn(page, 'Admin');

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('header nav button')].find(x => x.textContent.trim().startsWith('Customers'));
    if (b) b.click();
  });
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: OUT + '/20-customers-dark.png' });

  // contrast sanity: find visible text whose colour nearly matches its background
  const lowContrast = await page.evaluate(() => {
    const parse = c => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = el => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return parse(c);
        n = n.parentElement;
      }
      return parse(getComputedStyle(document.body).backgroundColor);
    };
    const out = [];
    for (const el of document.querySelectorAll('button, a, span, p, h1, h2, h3, td, th, strong')) {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 42 || el.children.length) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.top > 2000) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.opacity === '0') continue;
      const fg = parse(st.color), bg = bgOf(el);
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (ratio < 2.2) out.push({ t: t.slice(0, 40), ratio: +ratio.toFixed(2), fg: st.color });
    }
    return out.slice(0, 15);
  });

  await browser.close();
  console.log('low-contrast text (ratio < 2.2):', lowContrast.length);
  lowContrast.forEach(x => console.log('  ' + JSON.stringify(x)));
  console.log('errors:', errors.length);
  errors.slice(0, 8).forEach(e => console.log('  ' + e));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
