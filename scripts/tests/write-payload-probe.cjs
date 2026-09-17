/**
 * READ-ONLY probe of what the browser actually sends when customers change.
 *
 * Every mutating request to Supabase REST and to this app's API is ABORTED at
 * the network layer before it leaves the browser (request interception), so
 * nothing reaches the database. The captured bodies are the evidence for the
 * write-path analysis in docs/product-audit/11-SECURITY-RELIABILITY.md.
 *
 *   node scripts/tests/write-payload-probe.cjs <out-dir> "<company A>" "<company B>" "<company C>"
 *
 * Signs in with the credentials scripts/signin.cjs uses (Admin, so every
 * control is available). Scenarios, each on its own account so an aborted
 * (and therefore still-unsaved) change from one does not ride along with the
 * next:
 *   1. A: edit dialog, saved without changes        → expect NO request
 *   2. A: edit dialog, phone number changed          → expect contact_number
 *   3. B: row owner dropdown changed                 → expect crm_owner_id
 *   4. C: follow-up dialog, Urgent toggled, saved    → expect is_urgent (+ last_follow_up_on, which the dialog stamps);
 *      the dialog stays open because the aborted write is a refusal to the app — the probe closes it
 *   5. Data source → Sync balances → Update balances → expect only rows whose figures moved, money columns only
 * A report of every captured request, with the columns it carried, is written
 * to <out-dir>/write-payload-probe.json and summarised on stdout.
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const [OUT, COMPANY_A, COMPANY_B, COMPANY_C] = [process.argv[2], process.argv[3], process.argv[4], process.argv[5]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** The app under probe: a local dev server by default, or the deployed site (PROBE_BASE=https://…) — safe either way, every write is aborted. */
const BASE = (process.env.PROBE_BASE || 'http://localhost:3000').replace(/\/$/, '');

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const captured = [];   // every mutating request, aborted
    const loaded = {};     // the rows as the browser received them (GET responses)
    let scenario = 'setup';
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url(); const m = req.method();
        const mutating = m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
        const isRest = /\/rest\/v1\//.test(url);
        const isApi = /\/api\/(team|daily-report|gemini-report)/.test(url);
        if (mutating && (isRest || isApi)) {
            let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { body = req.postData() || null; }
            captured.push({ scenario, method: m, url: url.replace(/^https:\/\/[^/]+/, ''), columns: body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort() : null, body, at: new Date().toISOString() });
            return req.abort('blockedbyclient');
        }
        req.continue();
    });
    page.on('response', async (res) => {
        try {
            if (res.request().method() === 'GET' && /\/rest\/v1\/customers\?/.test(res.url())) {
                const rows = await res.json();
                if (Array.isArray(rows)) rows.forEach((r) => { loaded[r.id] = r; });
            }
        } catch { /* not json */ }
    });

    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
    await signIn(page);
    await wait(1500);
    await page.goto(BASE + '/#customers', { waitUntil: 'networkidle2' });
    await wait(1500);

    const search = async (q) => { await page.evaluate(() => { const i = document.querySelector('input[placeholder^="Search by name"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); }); await page.type('input[placeholder^="Search by name"]', q); await wait(900); };
    const firstRowButton = (title) => page.evaluate((t) => { const b = [...document.querySelectorAll('tbody tr button')].find((x) => (x.getAttribute('title') || '').startsWith(t)); if (!b) return false; b.click(); return true; }, title);
    const press = (label) => page.evaluate((l) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l) || [...document.querySelectorAll('form button[type="submit"]')].find((x) => /save/i.test(x.textContent)); if (!b) return false; b.click(); return true; }, label);
    const settle = () => wait(1600); // past the hook's 800 ms debounce
    /** Closes whatever dialog is open — since the reliability batch a refused save keeps its dialog open. */
    const closeDialogs = async () => { for (let i = 0; i < 3; i++) { const closed = await page.evaluate(() => { const b = [...document.querySelectorAll('button[aria-label="Close"]')].pop(); if (!b) return false; b.click(); return true; }); if (!closed) break; await wait(400); } };

    // 1. A: edit dialog, no change
    scenario = '1 edit dialog, no change';
    await search(COMPANY_A);
    await firstRowButton('Edit customer master details'); await wait(500);
    await press('Save Changes'); await settle();

    // 2. A: edit dialog, phone number only
    scenario = '2 edit dialog, phone number only';
    await firstRowButton('Edit customer master details'); await wait(500);
    await page.evaluate(() => { const i = document.querySelector('input[placeholder="e.g. 9876543210"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '9800000000'); i.dispatchEvent(new Event('input', { bubbles: true })); });
    await press('Save Changes'); await settle();
    // A refused save keeps the edit dialog open (reliability batch); close it before the next scenario.
    await closeDialogs();

    // 3. B: owner dropdown on the row
    scenario = '3 owner dropdown';
    await search(COMPANY_B);
    const ownerSel = await page.$('tbody tr select[aria-label^="CRM owner for"]');
    if (ownerSel) {
        const options = await ownerSel.$$eval('option', (os) => os.map((o) => o.value));
        const current = await ownerSel.evaluate((s) => s.value);
        const other = options.find((v) => v && v !== current);
        if (other) { await ownerSel.select(other); await settle(); }
    }

    // 4. C: follow-up dialog, urgency toggled
    scenario = '4 follow-up dialog, urgent toggled';
    await search(COMPANY_C);
    await page.evaluate(() => { const b = [...document.querySelectorAll('tbody tr button')].find((x) => /^follow up$/i.test(x.textContent.trim())); b && b.click(); }); await wait(1000);
    await page.evaluate(() => { const c = document.querySelector('#isUrgent'); c && c.click(); });
    await press('Save follow-up'); await settle();
    // Since the reliability batch a refused save keeps the dialog open (the
    // abort above is a refusal to the app), so close it before moving on.
    await closeDialogs();

    // 5. balance sync: Data source → Sync balances → Update balances
    scenario = '5 balance sync';
    await page.goto(BASE + '/#source', { waitUntil: 'networkidle2' }); await wait(1200);
    await press('Sync balances');
    const t0 = Date.now(); while (Date.now() - t0 < 120000 && !(await page.evaluate(() => /Update balances/.test(document.body.innerText)))) await wait(500);
    await wait(800);
    const rowsInReview = await page.evaluate(() => (document.body.innerText.match(/Update balances\s*(\d+) rows/) || [])[1] || null);
    const confirmed = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Update balances/.test(x.textContent.trim())); if (!b) return false; b.click(); return true; });
    await wait(6000); // the write-back runs at 8 in flight; give it time to issue everything

    const report = { rowsInReview, confirmed, captured, loaded: Object.fromEntries(Object.entries(loaded).filter(([, r]) => [COMPANY_A, COMPANY_B, COMPANY_C].includes(r.company))) };
    fs.writeFileSync(path.join(OUT, 'write-payload-probe.json'), JSON.stringify(report, null, 2));
    const byScenario = {};
    captured.forEach((c) => { (byScenario[c.scenario] = byScenario[c.scenario] || []).push(c); });
    for (const [s, list] of Object.entries(byScenario)) {
        console.log(`${s}: ${list.length} request(s)`);
        const cols = {}; list.forEach((c) => { const k = (c.columns || ['(non-object body)']).join(','); cols[k] = (cols[k] || 0) + 1; });
        Object.entries(cols).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, n]) => console.log(`   ${n} × [${k}]`));
    }
    console.log(`scenario 1 requests: ${(byScenario['1 edit dialog, no change'] || []).length}; sync review rows: ${rowsInReview}; confirmed: ${confirmed}`);
    console.log(`captured ${captured.length} mutating request(s) in total, all aborted`);
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
