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
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  const errors = [];
  const warnings = [];
  page.on('console', m => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => {
    const u = r.url();
    if (!u.startsWith('data:')) errors.push('requestfailed: ' + u + ' — ' + (r.failure()?.errorText || ''));
  });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));

  // --- login screen ---
  const loginInfo = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      mounted: !!root && root.children.length > 0,
      html: (root?.innerHTML || '').length,
      text: (document.body.innerText || '').slice(0, 260),
      hasRoster: !!document.querySelector('input#pw') || document.body.innerText.includes('Find your name'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      theme: document.documentElement.getAttribute('data-theme'),
      font: getComputedStyle(document.body).fontFamily,
    };
  });
  await page.screenshot({ path: OUT + '/01-login.png' });

  // --- sign in as Admin ---
  let dash = null;
  if (true) {
    await signIn(page, 'Admin');
    dash = await page.evaluate(() => ({
      text: (document.body.innerText || '').slice(0, 700),
      navCount: document.querySelectorAll('aside button').length,
      h1: document.querySelector('h1')?.textContent || '',
      rows: document.querySelectorAll('tbody tr').length,
    }));
    await page.screenshot({ path: OUT + '/02-dashboard.png', fullPage: false });
  }

  await browser.close();

  console.log('=== LOGIN ===');
  console.log(JSON.stringify(loginInfo, null, 1));
  if (dash) {
    console.log('=== AFTER SIGN IN ===');
    console.log('h1:', dash.h1, '| sidebar buttons:', dash.navCount, '| table rows:', dash.rows);
    console.log('--- visible text ---');
    console.log(dash.text);
  }
  console.log('=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 25).forEach(e => console.log('  ' + e));
  process.exit(errors.length ? 2 : 0);
})().catch(e => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
