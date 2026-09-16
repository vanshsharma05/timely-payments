/**
 * The Live stock page as a CRM (TIMELY_EMAIL / TIMELY_PASSWORD in the env)
 * and then as the Admin (.deploy.local): prices absent for one, present for
 * the other. Writes nothing.
 */
const path = require('path');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function run(label, expectPrices) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    let stockBody = null;
    page.on('response', async (r) => { if (r.url().includes('/api/live-stock')) { try { stockBody = await r.json(); } catch {} } });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => { localStorage.setItem('timely_theme', 'light'); localStorage.removeItem('timely_live_stock_v2'); });
    await signIn(page);
    await page.goto('http://localhost:3000/#stock', { waitUntil: 'networkidle2' });
    const t0 = Date.now(); while (Date.now() - t0 < 90000 && !(await page.$('tbody tr'))) await wait(500);
    check(`${label}: overview folded on arrival`, !(await page.$('#stock-overview')));
    await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded]')].find((b) => /^Overview/.test(b.textContent.trim())).click()); await wait(500);
    const text = await page.evaluate(() => document.body.innerText);
    const heads = await page.$$eval('thead th', (ths) => ths.map((t) => t.textContent.replace(/[▼▲]/g, '').trim()));
    const sortOpts = await page.$$eval('select[aria-label="Sort by"] option', (os) => os.map((o) => o.textContent));
    const rupeeInPage = (text.match(/₹/g) || []).length;
    check(`${label}: /api/live-stock priced=${expectPrices}`, stockBody && stockBody.priced === expectPrices, stockBody && String(stockBody.priced));
    check(`${label}: Rate/Value columns ${expectPrices ? 'present' : 'absent'}`, (heads.includes('Rate') && heads.includes('Value')) === expectPrices, heads.join('|'));
    check(`${label}: sort offers value/rate ${expectPrices ? '' : 'not '}`, sortOpts.some((o) => /value|rate/i.test(o)) === expectPrices, sortOpts.join(' | '));
    check(`${label}: subtitle ${expectPrices ? 'has' : 'lacks'} the stock value`, /1,415 items[\s·]*₹[\d.]+ Cr[\s·]*in stock/.test(text) === expectPrices);
    check(`${label}: "Open the sheet" link ${expectPrices ? 'shown' : 'hidden'}`, /Open the sheet/.test(text) === expectPrices);
    check(`${label}: "Stock by brand" ${expectPrices ? 'by value' : 'by item count'}`, expectPrices ? /PIDILITE\s+₹[\d.]+ L · 102 items/.test(text) : /GENERAL\s+189 items/.test(text) && !/L · 102 items/.test(text));
    if (!expectPrices) {
        check(`${label}: no rupee sign anywhere on the page`, rupeeInPage === 0, `${rupeeInPage} found`);
        check(`${label}: the availability tiles still add up`, await page.evaluate(() => { const n = (l) => Number([...document.querySelectorAll('button, div')].find((b) => b.querySelector(':scope > span > .label')?.textContent.trim() === l)?.querySelector('.num')?.textContent.replace(/,/g, '')); return n('In stock') + n('Low stock') + n('Out of stock') === n('Total items') && n('Total items') === 1415; }));
        check(`${label}: default sort is Brand A–Z`, await page.$eval('select[aria-label="Sort by"]', (s) => s.value) === 'category:asc');
    } else {
        check(`${label}: default sort is highest value`, await page.$eval('select[aria-label="Sort by"]', (s) => s.value) === 'value:desc');
    }
    // the drawer
    await page.evaluate(() => { const i = document.querySelector('input[aria-label="Search stock"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'TABLE GUM(V-5650)'); i.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(500);
    await page.evaluate(() => document.querySelector('tbody tr').click()); await wait(800);
    const drawer = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '');
    check(`${label}: drawer ${expectPrices ? 'shows' : 'hides'} value, rate and "to bring back"`, (/VALUE/.test(drawer) && /RATE/.test(drawer) && /to bring back/.test(drawer)) === expectPrices && (/₹/.test(drawer) === expectPrices), drawer.slice(0, 120).replace(/\n/g, ' '));
    check(`${label}: drawer still says how short`, /KGS short/.test(drawer));
    check(`${label}: "Open in sheet" ${expectPrices ? 'shown' : 'hidden'}`, /Open in sheet/.test(drawer) === expectPrices);
    await page.screenshot({ path: path.join(OUT, `prices-${label}.png`) });
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
    await browser.close();
}

(async () => {
    if (!process.env.ADMIN_ONLY) await run('crm', false);
    delete process.env.TIMELY_EMAIL; delete process.env.TIMELY_PASSWORD;
    await run('admin', true);
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
