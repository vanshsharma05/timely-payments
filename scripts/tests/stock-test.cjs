/**
 * Live stock tab, as the Admin. The sheet changes daily, so every check is
 * against what the page itself reads today — tiles add up, a tile's filter
 * shows the tile's count, and so on — never against a remembered number.
 */
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
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    let sheetReads = 0;
    page.on('request', (r) => { if (r.url().includes('/api/live-stock')) sheetReads++; });

    const text = () => page.evaluate(() => document.body.innerText);
    const tap = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === t); if (!b) return false; b.click(); return true; }, t);
    const rowCount = () => page.evaluate(() => document.querySelectorAll('tbody tr').length);
    const inView = () => page.evaluate(() => Number((document.body.innerText.match(/([\d,]+) items? · -?₹[\d.,]+(?: L| Cr)? in view/) || [, '0'])[1].replace(/,/g, '')));
    const tile = (label) => page.evaluate((l) => { const b = [...document.querySelectorAll('button')].find((x) => x.querySelector('.label') && x.querySelector('.label').textContent.trim() === l); if (!b) return false; b.click(); return true; }, label);
    const tileNum = (label) => page.evaluate((l) => Number([...document.querySelectorAll('button, div')].find((b) => b.querySelector(':scope > span > .label')?.textContent.trim() === l)?.querySelector('.num')?.textContent.replace(/[,%]/g, '')), label);
    const reset = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Reset'); b && b.click(); }); await wait(300); };
    const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(300); } return false; };
    const qtyCol = () => page.evaluate(() => [...document.querySelectorAll('tbody tr td:nth-child(2)')].map((td) => Number(td.textContent.trim().split(/\s/)[0].replace(/,/g, ''))));

    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => { localStorage.setItem('timely_theme', 'light'); localStorage.removeItem('timely_live_stock_v2'); });
    await signIn(page);

    /* ---- the tab ---- */
    check('nav: Live stock is the fifth tab, after Reports', await page.evaluate(() => {
        const labels = [...document.querySelectorAll('nav[aria-label="Sections"]')[0].querySelectorAll('button')].map((b) => b.textContent.replace(/\d+$/, '').trim());
        return labels[3] === 'Reports' && labels[4] === 'Live stock';
    }));
    await page.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /Live stock/.test(b.textContent)).click());
    await wait(500);
    check('nav: title and URL', (await page.$eval('h1', (e) => e.textContent)) === 'Live stock' && (await page.evaluate(() => location.hash)) === '#stock');
    check('sheet read: rows arrive', await waitFor(async () => (await rowCount()) > 0, 90000), `${await rowCount()} rows mounted`);
    /* ---- the overview is folded on arrival; one click opens it ---- */
    check('overview: folded on arrival, no tiles in the DOM', !(await page.$('#stock-overview')) && !(await page.$('.label')));
    await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded]')].find((b) => /^Overview/.test(b.textContent.trim())).click()); await wait(500);
    check('overview: one click opens it', Boolean(await page.$('#stock-overview')));
    const t = await text();
    const total = await tileNum('Total items'), inS = await tileNum('In stock'), low = await tileNum('Low stock'), out = await tileNum('Out of stock'), health = await tileNum('Health score');
    check('tiles: in + low + out = total', inS + low + out === total && total > 1000, `${inS} + ${low} + ${out} = ${total}`);
    check('tiles: health = in-stock share', health === Math.round((100 * inS) / total), `${health}% vs ${Math.round((100 * inS) / total)}%`);
    check('subtitle: items, value, live', new RegExp(`${total.toLocaleString('en-IN')} items`).test(t) && /₹[\d.]+ Cr/.test(t) && /live from the stores sheet/.test(t));
    check('freshness bar: live + read just now', /Live from the stock sheet · read (just now|\d+s ago)/.test(t));
    const insights = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.label')].filter((l) => /^(Brands|Sub-categories|Total quantity|Critical items|Avg per item|Low or out)$/.test(l.textContent.trim())).map((l) => [l.textContent.trim(), l.nextElementSibling.textContent.trim()])));
    check('insights: six figures, all present', Object.keys(insights).length === 6 && Number(insights['Brands']) > 10 && Number(insights['Sub-categories']) > Number(insights['Brands']) && /^[\d,]+$/.test(insights['Total quantity']) && /^\d+$/.test(insights['Critical items']) && /^[\d.,]+$/.test(insights['Avg per item']) && /%$/.test(insights['Low or out']), JSON.stringify(insights));
    check('insights: low-or-out % matches the tiles', insights['Low or out'] === `${((100 * (low + out)) / total).toFixed(1)}%`, insights['Low or out']);
    check('search placeholder: stock wording', await page.$eval('header input[aria-label="Search"]', (i) => i.placeholder) === 'Search stock by item, brand, category');
    check('no book dates under the title on this tab', !/Book as of|Synced today/.test(t));
    check(`list: 60 rows mounted of ${total}`, (await rowCount()) === 60 && (await inView()) === total);
    check('list: sorted by value desc', await page.evaluate(() => { const v = [...document.querySelectorAll('tbody tr td:nth-child(5)')].map((td) => td.textContent.trim()); const n = (s) => { const m = s.match(/₹([\d.,]+)( L| Cr)?/); if (!m) return 0; const x = Number(m[1].replace(/,/g, '')); return m[2] === ' Cr' ? x * 1e7 : m[2] === ' L' ? x * 1e5 : x; }; return v.every((s, i) => i === 0 || n(v[i - 1]) >= n(s)); }));

    /* ---- tiles filter ---- */
    await tile('Low stock'); await wait(400);
    check(`tile: Low stock → ${low} in view`, (await inView()) === low, String(await inView()));
    check('tile: every row carries the Low stock chip', await page.evaluate(() => [...document.querySelectorAll('tbody tr')].every((r) => /Low stock/.test(r.textContent))));
    check('tile: Total items tile says how many are in view', new RegExp(`${low.toLocaleString('en-IN')} in view`).test(await text()));
    await tile('Low stock'); await wait(300);
    check('tile: pressing again clears', (await inView()) === total);
    await tile('Out of stock'); await wait(300);
    check(`tile: Out of stock → ${out}, every row at or below zero`, (await inView()) === out && (await qtyCol()).every((q) => q <= 0), String(await inView()));
    await tile('In stock'); await wait(300);
    check(`tile: switches to In stock → ${inS}`, (await inView()) === inS, String(await inView()));
    await tile('Total items'); await wait(300);
    check('tile: Total items clears', (await inView()) === total);
    const critical = Number(insights['Critical items']);
    await tap(`Show the ${critical} critical items`); await wait(400);
    check(`critical button → ${critical} rows, each out of stock and stocked/fast`, (await inView()) === critical && await page.evaluate(() => [...document.querySelectorAll('tbody tr')].every((r) => /Critical/.test(r.textContent) && /Out of stock/.test(r.textContent))), String(await inView()));
    await tap('Showing the critical items — press to clear'); await wait(300);
    check('critical button toggles off', (await inView()) === total);

    /* ---- brand bar ---- */
    const firstBrand = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /· \d+ items$/.test((x.textContent || '').trim())); if (!b) return null; const m = b.textContent.match(/(\d+) items$/); b.click(); return { label: b.querySelector('span').textContent.trim(), items: Number(m[1]) }; });
    await wait(300);
    check(`brand bar: ${firstBrand?.label} → ${firstBrand?.items} items`, firstBrand && (await inView()) === firstBrand.items, String(await inView()));
    check('brand select follows', await page.$eval('select[aria-label="Brand / category"]', (s) => s.value) === firstBrand?.label);
    await reset();

    /* ---- search ---- */
    await page.type('input[aria-label="Search stock"]', 'table gum'); await wait(400);
    check('search: narrows the list and every row matches', (await inView()) > 0 && (await inView()) < total && await page.evaluate(() => [...document.querySelectorAll('tbody tr')].every((r) => /TABLE GUM/i.test(r.textContent))), String(await inView()));
    await page.evaluate(() => document.querySelector('button[aria-label="Clear search"]').click()); await wait(300);
    await page.type('header input[aria-label="Search"]', 'pidicron'); await wait(400);
    check('app-bar search applies to stock', await page.evaluate(() => document.querySelectorAll('tbody tr').length > 0 && [...document.querySelectorAll('tbody tr')].every((r) => /PIDICRON/i.test(r.textContent))));
    await page.evaluate(() => document.querySelector('header button[aria-label="Clear search"]').click()); await wait(300);

    /* ---- sort ---- */
    await reset();
    await page.evaluate(() => [...document.querySelectorAll('th button')].find((b) => /Stock/.test(b.textContent)).click()); await wait(300);
    let q = await qtyCol();
    check('sort: Stock header → most quantity first', q.every((v, i) => i === 0 || q[i - 1] >= v) && q[0] > 1000, `${q[0]} first`);
    await page.evaluate(() => [...document.querySelectorAll('th button')].find((b) => /Stock/.test(b.textContent)).click()); await wait(300);
    q = await qtyCol();
    check('sort: second press flips ascending', q.every((v, i) => i === 0 || q[i - 1] <= v), `${q[0]} first`);
    await page.select('select[aria-label="Sort by"]', 'value:desc'); await wait(300);

    /* ---- chips + selects ---- */
    await reset();
    await tap('Out of stock'); await wait(300);
    check(`availability chip: Out of stock → ${out}`, (await inView()) === out, String(await inView()));
    await page.select('select[aria-label="Movement"]', 'FAST MOVING'); await wait(300);
    const outFast = await inView();
    check('movement select combines', outFast > 0 && outFast < out && await page.evaluate(() => [...document.querySelectorAll('tbody tr')].every((r) => /Fast moving/.test(r.textContent))), `${outFast} of ${out}`);
    await page.select('select[aria-label="Status"]', 'D'); await wait(300);
    check('status select combines further', (await inView()) <= outFast, String(await inView()));
    await tap('Reset'); await wait(300);
    check('reset clears everything', (await inView()) === total);

    /* ---- drawer with a photo ---- */
    await page.type('input[aria-label="Search stock"]', 'XUV-410'); await wait(400);
    await page.evaluate(() => document.querySelector('tbody tr').click()); await wait(800);
    check('drawer opens with the item', await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return !!d && /XUV-410 DT/.test(d.textContent) && /Open in sheet/.test(d.textContent); }));
    const link = await page.$eval('[role="dialog"] a[href*="range="]', (a) => a.href);
    check('drawer: Open in sheet deep-links to the row', /range=A3$/.test(link), link);
    await page.keyboard.press('Escape'); await wait(300);
    check('drawer: Escape closes', !(await page.$('[role="dialog"]')));
    await page.evaluate(() => document.querySelector('button[aria-label="Clear search"]').click()); await wait(300);
    await page.type('input[aria-label="Search stock"]', 'MICRO PL.BRIGHT ORANGE (TNP-2021) - 5 KGS'); await wait(400);
    await page.evaluate(() => document.querySelector('tbody tr').click()); await wait(800);
    await waitFor(() => page.evaluate(() => { const img = document.querySelector('[role="dialog"] img'); return !!img && img.naturalWidth > 0; }), 8000);
    const photo = await page.evaluate(() => { const img = document.querySelector('[role="dialog"] img'); return img ? { src: img.src, shown: img.naturalWidth > 0 && getComputedStyle(img).display !== 'none' } : null; });
    check('drawer: photo from Drive renders', !!photo && photo.shown, photo && photo.src);
    check('drawer: short item says how short and what it costs', await page.evaluate(() => /KGS short of the minimum — about ₹[\d,]+ to bring back/.test(document.querySelector('[role="dialog"]').textContent)));
    await page.screenshot({ path: path.join(OUT, 'stock-photo-drawer.png') });
    await page.keyboard.press('Escape'); await wait(200);
    await page.evaluate(() => document.querySelector('button[aria-label="Clear search"]').click()); await wait(300);

    /* ---- show more ---- */
    await tap(`Show more — ${(total - 60).toLocaleString('en-IN')} left`); await wait(500);
    check('show more mounts another 120', (await rowCount()) === 180);
    check('export offered (canExportData)', /Export all/.test(await text()));

    /* ---- dark mode ---- */
    await page.evaluate(() => document.querySelector('header button[aria-label="Switch to dark mode"]').click()); await wait(500);
    await page.screenshot({ path: path.join(OUT, 'stock-dark.png') });
    check('dark mode renders (no page errors)', errors.length === 0);
    await page.evaluate(() => document.querySelector('header button[aria-label="Switch to light mode"]').click());

    /* ---- polling ---- */
    const before = sheetReads;
    await wait(63000);
    check('polling: re-read within 63s', sheetReads > before, `${before} → ${sheetReads}`);
    await page.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /Customers/.test(b.textContent)).click()); await wait(500);
    const offTab = sheetReads;
    await wait(62000);
    check('polling: stops when the tab is not open', sheetReads === offTab, `${offTab} → ${sheetReads}`);

    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
