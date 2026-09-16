/**
 * The customer book's filters: every control's counts follow one rule, the
 * ageing chips carry counts, the overdue column and the order follow the
 * chip, Reset clears everything. As the Admin, laptop. Writes nothing.
 */
const path = require('path');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const num = (s) => Number(String(s || '').replace(/[^\d.-]/g, ''));
const inParens = (s) => num((String(s || '').match(/\(([\d,]+)\)/) || [])[1]);

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
    await signIn(page);
    await page.goto('http://localhost:3000/#customers', { waitUntil: 'networkidle2' });
    const waitFor = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(300); } return false; };
    await waitFor(() => page.evaluate(() => /Customer Ledger \(\d+ accounts\)/.test(document.body.innerText)));
    await wait(500);

    const text = () => page.evaluate(() => document.body.innerText);
    const chip = (re) => page.evaluate((src) => { const re = new RegExp(src); const b = [...document.querySelectorAll('button')].find((x) => re.test(x.textContent.replace(/\s+/g, ' ').trim())); return b ? b.textContent.replace(/\s+/g, ' ').trim() : null; }, re.source);
    const press = async (re) => { const ok = await page.evaluate((src) => { const re = new RegExp(src); const b = [...document.querySelectorAll('button')].find((x) => re.test(x.textContent.replace(/\s+/g, ' ').trim())); if (!b) return false; b.click(); return true; }, re.source); await wait(500); return ok; };
    const ledgerCount = async () => num(((await text()).match(/Customer Ledger \(([\d,]+) accounts\)/) || [])[1]);
    const options = (label) => page.$$eval(`select[aria-label="${label}"] option`, (os) => os.map((o) => o.textContent.trim()));
    const column = () => page.evaluate(() => {
        const ths = [...document.querySelectorAll('thead th')].map((t) => t.textContent.trim());
        const i = ths.findIndex((t) => /^(Due >\d+ days|Within 45 days|\d+–\d+ days)$/.test(t));
        const vals = [...document.querySelectorAll('tbody tr')].filter((r) => r.children.length > 1).map((r) => Number((r.children[i]?.textContent || '').replace(/[^\d.]/g, '')));
        return { label: ths[i], vals };
    });

    // more filters open
    await press(/^More filters$/);
    check('the chips are there', Boolean(await chip(/^Rank/)) || Boolean(await chip(/^All \(\d+\)$/)));

    /* ---- counts on every chip, and they add up ---- */
    const rankAll = inParens(await chip(/^All \(\d+\)$/)), good = inParens(await chip(/^Good \(\d+\)$/)), late = inParens(await chip(/^Late pay \(\d+\)$/)), bad = inParens(await chip(/^Bad debt \(\d+\)$/));
    check('rank: All = Good + Late + Bad', rankAll === good + late + bad && rankAll > 0, `${rankAll} = ${good} + ${late} + ${bad}`);
    const ageAll = inParens(await chip(/^All Ageing \(\d+\)$/)), cur = inParens(await chip(/^Current ≤45d \(\d+\)$/)), o45 = inParens(await chip(/^>45d \(\d+\)$/)), o90 = inParens(await chip(/^>90d \(\d+\)$/)), o135 = inParens(await chip(/^>135d \(\d+\)$/));
    check('ageing chips carry counts', [ageAll, cur, o45, o90, o135].every((n) => Number.isFinite(n)) && o45 > 0, `${ageAll} · ${cur} · ${o45} · ${o90} · ${o135}`);
    check('ageing: >45d ⊇ >90d ⊇ >135d', o45 >= o90 && o90 >= o135 && o135 > 0);
    check('ageing: Current + >45d ≤ All (the rest owe nothing overdue or are in credit)', cur + o45 <= ageAll);
    const n0 = await ledgerCount();
    check('nothing pressed: every "All" is the ledger count', rankAll === n0 && ageAll === n0, `${rankAll} / ${ageAll} / ledger ${n0}`);
    const cats = await options('Filter by customer category'), crms = await options('Filter by CRM owner'), statuses = await options('Status');
    check('categories: All = ledger, options add up', inParens(cats[0]) === n0 && cats.slice(1).reduce((s, o) => s + inParens(o), 0) === n0, `${cats[0]} vs ${cats.slice(1).reduce((s, o) => s + inParens(o), 0)}`);
    check('CRMs: All = ledger, portfolios + unassigned add up', inParens(crms[0]) === n0 && crms.slice(1).reduce((s, o) => s + inParens(o), 0) === n0, `${crms[0]}; ${crms.length - 1} options`);
    check('statuses: All = ledger, options add up', inParens(statuses[0]) === n0 && statuses.slice(1).reduce((s, o) => s + inParens(o), 0) === n0, statuses.join(' | '));

    /* ---- press >90d: counts follow, the column follows, the order follows ---- */
    await press(/^>90d \(\d+\)$/);
    const n90 = await ledgerCount();
    check('>90d: the ledger shows that many', n90 === o90, `${n90} vs ${o90}`);
    const rankAll90 = inParens(await chip(/^All \(\d+\)$/)), good90 = inParens(await chip(/^Good \(\d+\)$/)), late90 = inParens(await chip(/^Late pay \(\d+\)$/)), bad90 = inParens(await chip(/^Bad debt \(\d+\)$/));
    check('>90d: rank chips count within the chip, and add up', rankAll90 === n90 && good90 + late90 + bad90 === n90, `${rankAll90} = ${good90} + ${late90} + ${bad90}`);
    check('>90d: the ageing chips keep their own counts (not narrowed by themselves)', inParens(await chip(/^>45d \(\d+\)$/)) === o45 && inParens(await chip(/^>135d \(\d+\)$/)) === o135);
    check('>90d: the CRM and category "All" follow the chip too', inParens((await options('Filter by CRM owner'))[0]) === n90 && inParens((await options('Filter by customer category'))[0]) === n90);
    let col = await column();
    check('>90d: the overdue column reads Due >90 days', col.label === 'Due >90 days', col.label);
    check('>90d: every row shows money past 90 days, largest first', col.vals.length > 5 && col.vals.every((v) => v > 0) && col.vals.every((v, i) => i === 0 || col.vals[i - 1] >= v), col.vals.slice(0, 5).join(', '));
    check('>90d: the ledger says the order', /due >90 days, largest first/.test(await text()));
    check('>90d: "1 filter on"', /1 filter on/.test(await text()));
    await page.screenshot({ path: path.join(OUT, 'book-over90.png') });

    await press(/^>135d \(\d+\)$/);
    col = await column();
    check('>135d: column reads Due >135 days, every row > 0, largest first', col.label === 'Due >135 days' && col.vals.every((v) => v > 0) && col.vals.every((v, i) => i === 0 || col.vals[i - 1] >= v), col.vals.slice(0, 4).join(', '));
    check('>135d: the ledger shows the chip count', (await ledgerCount()) === o135);

    await press(/^Current ≤45d \(\d+\)$/);
    col = await column();
    check('Current: column reads Within 45 days, every row > 0', col.label === 'Within 45 days' && col.vals.every((v) => v > 0), col.label);
    check('Current: the ledger shows the chip count', (await ledgerCount()) === cur);

    /* ---- two filters: the count says two; Reset clears all, including the box ---- */
    await page.select('select[aria-label="Status"]', 'Upcoming'); await wait(500);
    check('with a status too: "2 filters on"', /2 filters on/.test(await text()));
    await page.type('input[placeholder^="Search by name"]', 'hosiery'); await wait(700);
    await press(/^Reset$/);
    check('Reset clears the chip, the status and the search box', (await ledgerCount()) === n0 && (await page.$eval('input[placeholder^="Search by name"]', (i) => i.value)) === '' && !/filters? on/.test(await text()));
    col = await column();
    check('back to Due >45 days, alphabetical', col.label === 'Due >45 days');

    check('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
