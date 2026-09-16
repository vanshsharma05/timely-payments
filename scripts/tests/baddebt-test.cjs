/**
 * Bad debt out of the routine lists, on a list of its own. As the Admin:
 * the strip on Today, the chip on Reports, no defaulter in Today / Overdue /
 * No Date / Future, every row on the recovery list a defaulter, and the
 * Today badge agreeing with the chips. Writes nothing.
 */
const path = require('path');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const num = (s) => Number(String(s).replace(/[^\d.]/g, ''));

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
    await signIn(page);
    await wait(1500);
    const text = () => page.evaluate(() => document.body.innerText);
    const waitFor = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(300); } return false; };
    await waitFor(async () => /Bad debt · \d/.test(await text()) || /Due today/.test(await text()));

    /* ---- Today (company view) ---- */
    const strip = () => page.evaluate(() => { const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => /^Bad debt ·/.test(x.innerText.trim())); return b ? b.innerText.replace(/\s+/g, ' ').trim() : null; });
    const s = await strip();
    check('Today: a Bad debt strip sits under the worklist cards', Boolean(s), s);
    const stripCount = num((s || '').match(/Bad debt · ([\d,]+) account/)?.[1]);
    check('Today: it says how many and how much, and that they are kept out', stripCount > 0 && /₹/.test(s) && /kept out of the worklist/.test(s));
    const cards = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('button[aria-pressed] .label')].map((l) => [l.textContent.trim(), l.closest('button').querySelector('.num').textContent.trim()])));
    const badge = await page.evaluate(() => { const b = [...document.querySelectorAll('nav[aria-label="Sections"] button')].find((x) => /^Today/.test(x.textContent.trim())); return Number((b.textContent.match(/\d+/) || [0])[0]); });
    check('Today: the badge is due today + overdue, defaulters out', badge === num(cards['Due today']) + num(cards['Overdue']), `${badge} = ${cards['Due today']} + ${cards['Overdue']}`);
    await page.screenshot({ path: path.join(OUT, 'baddebt-today.png') });

    /* ---- press it: Reports opens on the recovery list ---- */
    await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].find((x) => /^Bad debt ·/.test(x.innerText.trim())).click());
    await waitFor(async () => /Bad debt \(\d+\)/.test(await text()));
    await wait(500);
    const chip = (re) => page.evaluate((src) => { const re = new RegExp(src); const b = [...document.querySelectorAll('button')].find((x) => re.test(x.textContent.trim())); return b ? b.textContent.trim() : null; }, re.source);
    const badChip = await chip(/^Bad debt \(\d+\)$/);
    check('Reports: a Bad debt chip beside the follow-up chips', Boolean(badChip), badChip);
    check('Reports: its count is the strip\'s count', num(badChip) === stripCount, `${badChip} vs ${stripCount}`);
    const records = () => page.evaluate(() => Number((document.body.innerText.match(/(\d+) Records/) || [0, 0])[1]));
    const rowsRank = () => page.evaluate(() => [...document.querySelectorAll('tbody tr')].map((r) => r.innerText).filter((t) => t.trim()));
    check('Reports: it opened pressed, on the recovery list', (await records()) === stripCount, String(await records()));
    const badRows = await rowsRank();
    check('Reports: every row on the recovery list is a bad debt', badRows.length > 0 && badRows.every((t) => /Bad debt/.test(t)), `${badRows.filter((t) => /Bad debt/.test(t)).length}/${badRows.length}`);
    await page.screenshot({ path: path.join(OUT, 'baddebt-reports.png') });

    // the four follow-up lists carry no defaulter
    let sum = 0;
    for (const [label, re] of [['Today', /^Today \(\d+\)$/], ['No Date', /^No Date \(\d+\)$/], ['Overdue', /^Overdue \(\d+\)$/], ['Future', /^Future \(\d+\)$/]]) {
        const c = await chip(re);
        await page.evaluate((src) => { const re = new RegExp(src); [...document.querySelectorAll('button')].find((x) => re.test(x.textContent.trim())).click(); }, re.source); await wait(600);
        const n = num(c); sum += n;
        const rows = await rowsRank();
        check(`Reports: ${label} (${n}) shows ${n} records and none is a bad debt`, (await records()) === n && !rows.some((t) => /Bad debt/.test(t)), `${await records()} records, ${rows.filter((t) => /Bad debt/.test(t)).length} bad`);
    }
    const allChip = await chip(/^All \(\d+\)$/);
    const completed = num(await chip(/^Completed \(\d+\)$/));
    check('Reports: All = Today + No Date + Overdue + Future + Completed + Bad debt', num(allChip) === sum + completed + stripCount, `${allChip} vs ${sum} + ${completed} + ${stripCount}`);
    const todayChip = num(await chip(/^Today \(\d+\)$/)), overdueChip = num(await chip(/^Overdue \(\d+\)$/));
    check('Reports: Today and Overdue chips agree with the Today cards', todayChip === num(cards['Due today']) && overdueChip === num(cards['Overdue']), `${todayChip}/${overdueChip} vs ${cards['Due today']}/${cards['Overdue']}`);

    /* ---- the CRM table counts them outside the score ---- */
    await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Sections"] button')].find((x) => /^Today/.test(x.textContent.trim())).click()); await wait(800);
    const crmBad = await page.evaluate(() => [...document.querySelectorAll('td span')].filter((s) => /^\+\d+ bad debt$/.test(s.textContent.trim())).map((s) => Number(s.textContent.match(/\d+/)[0])).reduce((a, b) => a + b, 0));
    // An account with a collector counts on two rows, so the notes can only be at least the strip.
    check('CRM table: the "+n bad debt" notes cover the strip', crmBad >= stripCount, `${crmBad} vs ${stripCount}`);

    check('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
