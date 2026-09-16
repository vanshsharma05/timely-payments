/**
 * READ-ONLY probe of what the browser actually sends when a customer is saved.
 *
 * Every mutating request to Supabase REST and to this app's API is ABORTED at
 * the network layer before it leaves the browser (request interception), so
 * nothing reaches the database. The captured bodies are the evidence for the
 * lost-update analysis in docs/product-audit/11-SECURITY-RELIABILITY.md.
 *
 *   node scripts/tests/write-payload-probe.cjs <out-dir> "<company A>" "<company B>"
 *
 * Signs in with the credentials scripts/signin.cjs uses (Admin, so every
 * control is available). A: an account whose stored row carries a collector
 * and/or mixed Dr/Cr ageing types. B: any account, for the follow-up dialog.
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const [OUT, COMPANY_A, COMPANY_B] = [process.argv[2], process.argv[3], process.argv[4]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const captured = [];   // every mutating request, aborted
    const loaded = {};     // the rows as the browser received them (GET responses)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url(); const m = req.method();
        const mutating = m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
        const isRest = /\/rest\/v1\//.test(url);
        const isApi = /\/api\/(team|daily-report|fetch-sheet|gemini-report)/.test(url);
        if (mutating && (isRest || isApi)) {
            captured.push({ method: m, url: url.replace(/^https:\/\/[^/]+/, ''), body: req.postData() || null, at: new Date().toISOString() });
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

    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
    await signIn(page);
    await wait(1500);
    await page.goto('http://localhost:3000/#customers', { waitUntil: 'networkidle2' });
    await wait(1500);

    const search = async (q) => { await page.evaluate(() => { const i = document.querySelector('input[placeholder^="Search by name"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); }); await page.type('input[placeholder^="Search by name"]', q); await wait(900); };
    const firstRowButton = (title) => page.evaluate((t) => { const b = [...document.querySelectorAll('tbody tr button')].find((x) => (x.getAttribute('title') || '').startsWith(t)); if (!b) return false; b.click(); return true; }, title);
    const dialogSave = async (label) => page.evaluate((l) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === l) || [...document.querySelectorAll('form button[type="submit"]')].find((x) => /save/i.test(x.textContent)); if (!b) return false; b.click(); return true; }, label);

    // --- A: the edit dialog, saved without changing anything
    await search(COMPANY_A);
    const openedA = await firstRowButton('Edit customer master details');
    await wait(600);
    const savedA = openedA && await dialogSave('Save');
    await wait(1500);

    // --- B (edit dialog): an account with a collector, saved without changes
    await page.keyboard.press('Escape'); await wait(300);
    await search(COMPANY_B);
    const openedB = await firstRowButton('Edit customer master details');
    await wait(600);
    const savedBEdit = openedB && await dialogSave('Save');
    await wait(1500);

    // --- B (follow-up dialog): urgency toggled, saved
    await page.keyboard.press('Escape'); await wait(300);
    await page.evaluate(() => { const b = [...document.querySelectorAll('tbody tr button')].find((x) => x.textContent.trim() === 'Follow Up'); b && b.click(); }); await wait(1000);
    await page.evaluate(() => { const c = document.querySelector('#isUrgent'); c && c.click(); });
    const savedB = await dialogSave('Save Follow-up & Contacts');
    await wait(1500);

    const report = { openedA, savedA, openedB, savedBEdit, savedB, captured, loaded: Object.fromEntries(Object.entries(loaded).filter(([, r]) => [COMPANY_A, COMPANY_B].includes(r.company))) };
    fs.writeFileSync(path.join(OUT, 'write-payload-probe.json'), JSON.stringify(report, null, 2));
    console.log(`captured ${captured.length} mutating request(s), all aborted`);
    captured.forEach((c) => console.log(`  ${c.method} ${c.url.slice(0, 80)}  body ${c.body ? c.body.length : 0} bytes`));
    await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
