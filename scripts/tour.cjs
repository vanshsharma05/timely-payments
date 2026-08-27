const puppeteer = require('puppeteer-core');
const { signIn } = require('./signin.cjs');


const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { try { localStorage.setItem('timely_theme', 'light'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: OUT + '/10-login-light.png' });

  await signIn(page);
  await page.screenshot({ path: OUT + '/11-overview-light.png' });

  const clickNav = async label => {
    let done = await page.evaluate(t => {
      const b = [...document.querySelectorAll('header nav button')].find(x => x.textContent.trim().startsWith(t));
      if (b) { b.click(); return true; }
      return false;
    }, label);
    if (!done) {
      // may live under the Settings menu
      await page.evaluate(() => {
        const g = [...document.querySelectorAll('header nav button')].find(x => /Settings/.test(x.textContent));
        if (g) g.click();
      });
      await new Promise(r => setTimeout(r, 400));
      done = await page.evaluate(t => {
        const b = [...document.querySelectorAll('[role=\"menu\"] button')].find(x => x.textContent.trim().startsWith(t));
        if (b) { b.click(); return true; }
        return false;
      }, label);
    }
    await new Promise(r => setTimeout(r, 2200));
    return done;
  };

  const report = {};
  for (const [label, file] of [
    ['Customers', '12-customers'],
    ['PDC cheques', '13-pdc'],
    ['Reports', '14-reports'],
    ['Team & access', '15-team'],
  ]) {
    const ok = await clickNav(label);
    if (!ok) { report[label] = 'NAV NOT FOUND'; continue; }
    await page.screenshot({ path: `${OUT}/${file}.png` });
    report[label] = await page.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent || '',
      rows: document.querySelectorAll('tbody tr').length,
      textLen: (document.body.innerText || '').length,
    }));
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 1));
  console.log('=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 20).forEach(e => console.log('  ' + e));
})().catch(e => { console.error('TOUR FAILED:', e.message); process.exit(1); });
