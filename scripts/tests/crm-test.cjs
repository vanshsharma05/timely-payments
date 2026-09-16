/**
 * The CRM's side of both changes, through a throwaway CRM login that this
 * script creates through the app's own team route and deletes at the end:
 * Today renders (no strip with nothing on the book), and the compare panel
 * on Live stock carries no rate or value for a CRM. The one write is the
 * temporary login, and it is removed before the script exits.
 */
const path = require('path');
const crypto = require('crypto');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const TEMP = { id: 'ZZ_TEST_CRM', name: 'ZZ Test CRM (temporary)', email: 'zz.test.crm.timely@example.com', password: crypto.randomBytes(12).toString('base64url'), role: 'CRM' };

const teamCall = (page, body) => page.evaluate(async (body) => {
    const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const token = key ? JSON.parse(localStorage.getItem(key)).access_token : '';
    const r = await fetch('/api/team', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
}, body);

(async () => {
    // --- as the Admin: create the throwaway CRM
    const admin = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const ap = await admin.newPage();
    await ap.setViewport({ width: 1440, height: 900 });
    await ap.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await signIn(ap);
    await wait(1000);
    const created = await teamCall(ap, { action: 'create', user: TEMP });
    check('temp CRM login created through /api/team', created.status === 200 && created.body.ok, JSON.stringify(created.body));
    if (!(created.status === 200 && created.body.ok)) { await admin.close(); process.exit(1); }

    try {
        const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        process.env.TIMELY_EMAIL = TEMP.email; process.env.TIMELY_PASSWORD = TEMP.password;
        await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
        await page.evaluate(() => { localStorage.setItem('timely_theme', 'light'); sessionStorage.removeItem('timely_stock_compare'); });
        await signIn(page);
        await wait(2000);
        const text = () => page.evaluate(() => document.body.innerText);
        const t = await text();
        check('CRM: Today renders the personal worklist', /My worklist/.test(t) && /Due today/i.test(t));
        check('CRM: no Bad debt strip with nothing on the book', !/Bad debt ·/.test(t));
        await page.screenshot({ path: path.join(OUT, 'crm-today.png') });

        // the compare panel for a CRM: no rate, no value, no rupee
        await page.goto('http://localhost:3000/#stock', { waitUntil: 'networkidle2' });
        const rowSel = 'input[aria-label^="Compare "]';
        const t0 = Date.now(); while (Date.now() - t0 < 90000 && !(await page.$('tbody tr'))) await wait(500);
        await wait(400);
        await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].find((x) => x.textContent.trim() === 'Compare').click()); await wait(400);
        for (let i = 0; i < 3; i++) { await page.evaluate((sel) => { const b = [...document.querySelectorAll(sel)].find((x) => !x.checked); b && b.click(); }, rowSel); await wait(150); }
        await page.evaluate(() => [...document.querySelectorAll('[role="region"][aria-label="Items to compare"] button')].find((b) => /^Compare/.test(b.textContent.trim())).click()); await wait(500);
        const d = await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /^Comparing/.test(x.getAttribute('aria-label') || '')); return d ? { text: d.innerText, cols: d.querySelectorAll('thead th').length - 1, rows: [...d.querySelectorAll('tbody th')].map((t) => t.textContent.trim()) } : null; });
        check('CRM: compare panel opens with three columns', d && d.cols === 3, d && String(d.cols));
        check('CRM: no Rate or Value row, no rupee anywhere in it', d && !d.rows.some((r) => /^(rate|value)$/i.test(r)) && !/₹/.test(d.text), d && d.rows.join('|'));
        check('CRM: the other rows are all there', d && ['Availability', 'In stock', 'Levels', 'Short by', 'Status', 'Movement', 'Last received'].every((r) => d.rows.some((x) => x.toLowerCase() === r.toLowerCase())));
        await page.screenshot({ path: path.join(OUT, 'crm-compare.png') });
        check('CRM: no page errors', errors.length === 0, errors.join(' | '));
        await browser.close();
    } finally {
        // --- as the Admin: remove the throwaway CRM, and make sure it is gone
        const removed = await teamCall(ap, { action: 'delete', user: { id: TEMP.id } });
        check('temp CRM login removed', removed.status === 200 && removed.body.ok, JSON.stringify(removed.body));
        const again = await teamCall(ap, { action: 'delete', user: { id: TEMP.id } });
        check('and it is really gone (a second delete finds nothing)', again.status !== 200, JSON.stringify(again.body));
        await admin.close();
    }
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
