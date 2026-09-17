/**
 * READ-ONLY probe of the status contract: what the browser sends for the
 * follow-up actions once the tab's calendar has moved on.
 *
 * Every mutating request to Supabase REST and to this app's API is ABORTED at
 * the network layer before it leaves the browser, so nothing reaches the
 * database; each scenario opens on the data the tab loaded, unsaved.
 *
 *   node scripts/tests/status-contract-probe.cjs <out-dir> "<company A>" ["<company B>"]
 *
 * After the book has loaded, the clock the page reads is moved 24 hours ahead
 * (the data is not) — the tab somebody left open overnight, making its first
 * change in the morning, which is when stored follow-up words go stale.
 * Scenarios (1 and 2 on account A — an aborted change stays in the tab unsaved,
 * so 2 also carries 1's is_urgent; 3 on account B, because the edit dialog is a
 * form and an account whose sheet email is "#REF!" cannot pass its validation):
 *   1. A: follow-up dialog, Urgent toggled, saved     → expect is_urgent, last_follow_up_on — and NO status
 *   2. A: follow-up dialog, "Payment collected"       → expect follow_up_date, last_follow_up_on, status: Completed (+ is_urgent from 1)
 *   3. B: edit dialog, next follow-up date changed    → expect follow_up_date only for B (A's still-unsaved
 *      row is retried on the same pass, as useCollectionSync retries a failed row — that one is listed too)
 * A report of every captured request is written to <out-dir>/status-contract-probe.json.
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const [OUT, COMPANY, COMPANY_B] = [process.argv[2], process.argv[3], process.argv[4] || process.argv[3]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** The app under probe: a local dev server by default, or the deployed site (PROBE_BASE=https://…) — safe either way, every write is aborted. */
const BASE = (process.env.PROBE_BASE || 'http://localhost:3000').replace(/\/$/, '');

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const captured = [];
    let scenario = 'setup';
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url(); const m = req.method();
        const mutating = m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
        if (mutating && (/\/rest\/v1\//.test(url) || /\/api\/(team|daily-report|gemini-report)/.test(url))) {
            let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { body = req.postData() || null; }
            const columns = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort() : null;
            captured.push({ scenario, method: m, url: url.replace(/^https:\/\/[^/]+/, ''), columns, status: body && typeof body === 'object' ? body.status : undefined, at: new Date().toISOString() });
            return req.abort('blockedbyclient');
        }
        req.continue();
    });

    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
    await signIn(page);
    await wait(1500);
    await page.goto(BASE + '/#customers', { waitUntil: 'networkidle2' });
    await wait(1500);

    // Tomorrow arrives inside the tab.
    await page.evaluate(() => {
        const RealDate = Date; const OFFSET = 86400000;
        class ShiftedDate extends RealDate { constructor(...args) { if (args.length === 0) super(RealDate.now() + OFFSET); else super(...args); } static now() { return RealDate.now() + OFFSET; } }
        window.Date = ShiftedDate;
    });
    const clock = await page.evaluate(() => new Date().toString().slice(0, 24));

    const search = async (q) => { await page.evaluate((v) => { const i = document.querySelector('input[placeholder^="Search by name"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }, q); await wait(900); };
    const rowButton = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll('tbody tr button')].find((x) => x.textContent.trim().toLowerCase() === t.toLowerCase() || (x.getAttribute('title') || '').startsWith(t)); if (!b) return false; b.click(); return true; }, text);
    const press = (label) => page.evaluate((l) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l); if (!b) return false; b.click(); return true; }, label);
    const settle = () => wait(1600); // past the hook's 800 ms debounce
    const setInput = (selector, value) => page.evaluate((s, v) => { const i = document.querySelector(s); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; }, selector, value);

    await search(COMPANY);

    scenario = '1 follow-up dialog, urgent toggled';
    await rowButton('Follow up'); await wait(1000);
    await page.evaluate(() => { const c = document.querySelector('#isUrgent'); c && c.click(); });
    await press('Save follow-up'); await settle();

    scenario = '2 follow-up dialog, payment collected';
    await rowButton('Follow up'); await wait(1000);
    await page.evaluate(() => { const r = document.querySelector('input[name="outcome"][value="collected"]'); r && r.click(); });
    await press('Save follow-up'); await settle();

    scenario = '3 edit dialog, next follow-up date changed';
    await search(COMPANY_B);
    await rowButton('Edit customer master details'); await wait(600);
    await setInput('input[aria-label="Next Follow-up Date"]', '2099-12-01');
    await press('Save Changes'); await settle();

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'status-contract-probe.json'), JSON.stringify({ companies: [COMPANY, COMPANY_B], clock, captured }, null, 2));
    console.log(`clock in the tab: ${clock}`);
    const by = {}; captured.forEach((c) => { (by[c.scenario] = by[c.scenario] || []).push(c); });
    for (const s of ['1 follow-up dialog, urgent toggled', '2 follow-up dialog, payment collected', '3 edit dialog, next follow-up date changed']) {
        const list = by[s] || [];
        console.log(`${s}: ${list.length} request(s)`);
        list.forEach((c) => console.log(`    ${c.method} ${c.url.split('?')[0]}  [${(c.columns || []).join(',')}]${c.status !== undefined ? `  status=${JSON.stringify(c.status)}` : ''}`));
    }
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
