/**
 * Live stock — several products at once, second design. The plain list has
 * no tick boxes; "Compare" in the list header puts them on; the ticks
 * survive a change of search or filter and a reload; the bar at the foot
 * keeps them in view; Compare lays them side by side; Done puts the list
 * back. Laptop as Admin, then a phone. Writes nothing.
 */
const path = require('path');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function run(label, viewport) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => { localStorage.setItem('timely_theme', 'light'); sessionStorage.removeItem('timely_stock_compare'); });
    await signIn(page);
    await page.goto('http://localhost:3000/#stock', { waitUntil: 'networkidle2' });
    const rowSel = 'input[aria-label^="Compare "], input[aria-label^="Take out"]';
    const anyRow = 'tbody tr, main button.flex-1';
    const t0 = Date.now(); while (Date.now() - t0 < 90000 && !(await page.$(anyRow))) await wait(500);
    await wait(400);

    const search = async (q) => { await page.evaluate((q) => { const i = document.querySelector('input[aria-label="Search stock"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, q); i.dispatchEvent(new Event('input', { bubbles: true })); }, q); await wait(500); };
    const modeButton = () => page.evaluate(() => { const b = [...document.querySelectorAll('button[aria-pressed]')].find((x) => /^(Compare|Done)$/.test(x.textContent.trim())); return b ? { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') } : null; });
    const pressMode = async () => { await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].find((x) => /^(Compare|Done)$/.test(x.textContent.trim())).click()); await wait(400); };
    const boxes = () => page.$$eval(rowSel, (els) => els.length);
    const tickFirst = async () => page.evaluate((sel) => { const b = document.querySelector(sel); if (!b) return null; const code = b.getAttribute('aria-label').replace(/^(Compare|Take out of the comparison:)\s*/, ''); b.click(); return code; }, rowSel);
    const bar = () => page.evaluate(() => { const r = document.querySelector('[role="region"][aria-label="Items to compare"]'); return r ? r.innerText.replace(/\s+/g, ' ').trim() : null; });
    const barButton = async (re) => { await page.evaluate((src) => { const re = new RegExp(src); [...document.querySelectorAll('[role="region"][aria-label="Items to compare"] button')].find((b) => re.test(b.textContent.trim()) || re.test(b.getAttribute('aria-label') || '')).click(); }, re.source); await wait(450); };
    const dialog = () => page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /^Comparing/.test(x.getAttribute('aria-label') || '')); return d ? { text: d.innerText, cols: d.querySelectorAll('thead th').length - 1, rows: [...d.querySelectorAll('tbody th')].map((t) => t.textContent.trim()) } : null; });
    const drawerOpen = () => page.evaluate(() => Boolean([...document.querySelectorAll('[role="dialog"]')].find((x) => !/^Comparing/.test(x.getAttribute('aria-label') || ''))));
    const pressRow = async () => { await page.evaluate((sel) => { const b = document.querySelector(sel); (b.closest('tr') || b).click(); }, anyRow); await wait(500); };

    // the plain list
    check(`${label}: the plain list has no tick boxes and no bar`, (await boxes()) === 0 && (await bar()) === null);
    let m = await modeButton();
    check(`${label}: a Compare button sits in the list header, not pressed`, m && m.text === 'Compare' && m.pressed === 'false', JSON.stringify(m));
    await pressRow();
    check(`${label}: pressing a row opens its drawer`, await drawerOpen());
    await page.keyboard.press('Escape'); await wait(300);

    // into compare mode
    await pressMode();
    m = await modeButton();
    check(`${label}: Compare turns the button into Done and puts a box on every row`, m && m.text === 'Done' && m.pressed === 'true' && (await boxes()) > 10, `${await boxes()} boxes`);
    check(`${label}: the bar explains what to do while nothing is ticked`, /Tick the items you want side by side/.test(await bar()), await bar());
    check(`${label}: Compare in the bar is disabled with nothing ticked`, await page.evaluate(() => [...document.querySelectorAll('[role="region"][aria-label="Items to compare"] button')].find((b) => /^Compare/.test(b.textContent.trim())).disabled));
    await page.screenshot({ path: path.join(OUT, `compare2-mode-${label}.png`) });

    // one from one search, one from another — the second by pressing the row itself
    await search('TABLE GUM');
    const first = await tickFirst(); await wait(300);
    check(`${label}: ticking a row fills the bar, opens no drawer`, /1 of 8/.test(await bar()) && (await bar()).includes(first) && !(await drawerOpen()), await bar());
    await search('DTF INK');
    const second = await page.evaluate((sel) => { const b = document.querySelector(sel); const code = b.getAttribute('aria-label').replace(/^Compare\s*/, ''); (b.closest('tr') || b.closest('div').querySelector('button.flex-1')).click(); return code; }, rowSel); await wait(300);
    check(`${label}: while comparing, pressing the row ticks it`, /2 of 8/.test(await bar()) && (await bar()).includes(second) && !(await drawerOpen()), await bar());
    check(`${label}: the first tick survived the new search`, (await bar()).includes(first));
    check(`${label}: two different items`, first !== second, `${first} / ${second}`);
    await search('');
    await page.select('select[aria-label="Status"]', 'FM'); await wait(400);
    check(`${label}: ticks survive a filter change`, /2 of 8/.test(await bar()));
    await page.select('select[aria-label="Status"]', 'ALL'); await wait(300);
    check(`${label}: ticked rows read as checked in the list`, (await page.$$eval(rowSel, (els) => els.filter((e) => e.checked).length)) === 2);
    await page.screenshot({ path: path.join(OUT, `compare2-bar-${label}.png`) });

    // side by side
    await barButton(/^Compare/);
    let d = await dialog();
    check(`${label}: Compare opens a panel with one column per item`, d && d.cols === 2, d && String(d.cols));
    check(`${label}: the same facts in the same rows`, d && ['Availability', 'In stock', 'Levels', 'Short by', 'Rate', 'Value', 'Status', 'Movement', 'Last received', 'Avg sales qty', 'Transactions', 'MOQ', 'GST', 'Colour', 'Sheet row'].every((r) => d.rows.some((x) => x.toLowerCase() === r.toLowerCase())), d && d.rows.join('|'));
    check(`${label}: both items are named in the panel`, d && d.text.includes(first) && d.text.includes(second));
    check(`${label}: the bar steps aside while the panel is open`, (await bar()) === null);
    await page.screenshot({ path: path.join(OUT, `compare2-panel-${label}.png`) });
    await page.evaluate((code) => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.getAttribute('aria-label') === `Take ${code} out of the comparison`).click(), first); await wait(300);
    d = await dialog();
    check(`${label}: × in a column takes that item out`, d && d.cols === 1 && !d.text.includes(first) && d.text.includes(second), d && String(d.cols));
    // the item's name opens its drawer
    await page.evaluate((code) => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === code && b.title === 'Open this item').click(), second); await wait(400);
    check(`${label}: an item's name in the panel opens its drawer`, await drawerOpen() && (await dialog()) === null);
    await page.keyboard.press('Escape'); await wait(300);
    check(`${label}: back on the list, still comparing, the bar is back`, /1 of 8/.test(await bar()) && (await modeButton()).text === 'Done');

    // a reload keeps the mode and the tick (same tab)
    await page.reload({ waitUntil: 'networkidle2' });
    const t1 = Date.now(); while (Date.now() - t1 < 90000 && !(await page.$(anyRow))) await wait(500);
    await wait(500);
    check(`${label}: after a reload, still comparing, the tick still there`, (await modeButton()).text === 'Done' && /1 of 8/.test((await bar()) || '') && ((await bar()) || '').includes(second), await bar());

    // the cap
    for (let i = 0; i < 9; i++) { await page.evaluate((sel) => { const b = [...document.querySelectorAll(sel)].find((x) => !x.checked && !x.disabled); b && b.click(); }, rowSel); await wait(120); }
    check(`${label}: no more than 8 can be ticked`, /8 of 8/.test(await bar()), await bar());
    check(`${label}: the ninth box is disabled, ticked ones are not`, await page.$$eval(rowSel, (els) => els.filter((e) => !e.checked).every((e) => e.disabled) && els.filter((e) => e.checked).every((e) => !e.disabled)));
    await barButton(/^Compare/);
    d = await dialog();
    check(`${label}: eight columns side by side`, d && d.cols === 8);
    await page.screenshot({ path: path.join(OUT, `compare2-8-${label}.png`) });
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Clear all').click()); await wait(300);
    check(`${label}: Clear all empties the picks and closes the panel, still comparing`, (await dialog()) === null && /Tick the items/.test(await bar()) && (await boxes()) > 10);

    // done
    await barButton(/Done comparing/);
    check(`${label}: Done puts the plain list back — no boxes, no bar`, (await boxes()) === 0 && (await bar()) === null && (await modeButton()).text === 'Compare');
    await pressRow();
    check(`${label}: and a row opens its drawer again`, await drawerOpen());
    await page.keyboard.press('Escape'); await wait(200);
    check(`${label}: no page errors`, errors.length === 0, errors.join(' | '));
    await browser.close();
}

(async () => {
    await run('laptop', { width: 1440, height: 900 });
    await run('phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
