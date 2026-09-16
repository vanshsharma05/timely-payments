const path = require('path');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const tap = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim() === t); if (!b) return false; b.click(); return true; }, t);
    const ledger = () => page.evaluate(() => Number((document.body.innerText.match(/Customer Ledger \(([\d,]+) accounts\)/) || [, '0'])[1].replace(/,/g, '')));
    const rankChips = () => page.evaluate(() => { const m = document.body.innerText.match(/All \((\d+)\)\s+Good \((\d+)\)\s+Late pay \((\d+)\)\s+Bad debt \((\d+)\)/); return m ? m.slice(1).map(Number) : null; });
    const rowsAllSatisfy = (fn) => page.evaluate((src) => { const f = eval(src); return [...document.querySelectorAll('#customer-table-scroll-container tbody tr')].every(f); }, fn.toString());

    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
    await signIn(page);
    await page.goto('http://localhost:3000/#customers', { waitUntil: 'networkidle2' }); await wait(3500);
    await tap('More filters'); await wait(400);
    check('book: 643 with dues', (await ledger()) === 643, String(await ledger()));
    check('rank chips: All 643 · Good 129 · Late 457 · Bad 57', JSON.stringify(await rankChips()) === '[643,129,457,57]', JSON.stringify(await rankChips()));

    const expect = { 'Current ≤45d (89)': [89, [89, 88, 1, 0]], '>45d (520)': [520, [520, 8, 456, 56]], '>90d (459)': [459, [459, 6, 397, 56]], '>135d (366)': [366, [366, 4, 306, 56]] };
    for (const [label, [count, chips]] of Object.entries(expect)) {
        await tap(label); await wait(500);
        const n = await ledger(); const rc = await rankChips();
        check(`chip ${label}: ${count} accounts, rank chips ${chips.join('/')}`, n === count && JSON.stringify(rc) === JSON.stringify(chips), `${n} · ${JSON.stringify(rc)}`);
        if (label === '>90d (459)') {
            check('  no CR balance in the >90d list', await rowsAllSatisfy((r) => !/\bCR\b/.test(r.querySelector('td:nth-child(3)')?.textContent || '')));
            await page.screenshot({ path: path.join(OUT, 'chips-over90.png') });
        }
        await tap(label); await wait(300);
        check(`  ${label} toggles off`, (await ledger()) === 643);
    }

    // rank chips inside an ageing filter
    await tap('>90d (459)'); await wait(300);
    await tap('Good (6)'); await wait(400);
    check('rank chip inside >90d: Good (6) → 6 rows', (await ledger()) === 6, String(await ledger()));
    check('  and they are all set by hand (Good pill on every row)', await rowsAllSatisfy((r) => /Good/.test(r.textContent)));
    await tap('Good (6)'); await wait(300);
    await tap('Bad debt (56)'); await wait(400);
    check('rank chip inside >90d: Bad debt (56) → 56 rows', (await ledger()) === 56);
    check('  rank chips unchanged while one is pressed', JSON.stringify(await rankChips()) === '[459,6,397,56]', JSON.stringify(await rankChips()));
    await tap('All (459)'); await wait(300);
    check('All (459) clears the rank filter', (await ledger()) === 459);
    await tap('>90d (459)'); await wait(300);

    // the credit account row: empty bar, no "due > 45"
    await page.type('input[placeholder^="Search by name"]', 'U.K. OFFSET'); await wait(600);
    const row = await page.evaluate(() => { const r = document.querySelector('#customer-table-scroll-container tbody tr'); if (!r) return null; return { text: r.innerText.replace(/\s+/g, ' '), bars: r.querySelectorAll('[role="img"] div').length }; });
    check('credit account row: CR badge, no overdue, empty ageing bar', row && /CR/.test(row.text) && row.bars === 0 && /₹0|—/.test(row.text), row && row.text.slice(0, 160));

    // Reports agrees
    await page.goto('http://localhost:3000/#reports', { waitUntil: 'networkidle2' }); await wait(3500);
    const rep = await page.evaluate(() => document.body.innerText.match(/>90d Total \((\d+)\)/)?.[1]);
    check('reports: ">90d Total" chip agrees (459)', rep === '459', rep);
    const cards = await page.evaluate(() => ({ o90: document.body.innerText.match(/>90 DAYS OVERDUE\s+(\d+)/i)?.[1], o135: document.body.innerText.match(/>135 DAYS CRITICAL\s+(\d+)/i)?.[1] }));
    check('reports: instant-report cards agree (459 / 366)', cards.o90 === '459' && cards.o135 === '366', JSON.stringify(cards));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
