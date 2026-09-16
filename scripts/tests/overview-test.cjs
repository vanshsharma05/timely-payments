/**
 * The Live stock overview fold: closed on arrival, one click open, one click
 * closed, the critical filter still reachable with it closed, and the same on
 * a phone. Signs in as the Admin (.deploy.local). Writes nothing.
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
    await page.evaluate(() => { localStorage.setItem('timely_theme', 'light'); });
    await signIn(page);
    await page.goto('http://localhost:3000/#stock', { waitUntil: 'networkidle2' });
    const t0 = Date.now(); while (Date.now() - t0 < 90000 && !(await page.$('tbody tr, [data-phone-row], main button.w-full.text-left'))) await wait(500);
    await wait(500);

    const text = () => page.evaluate(() => document.body.innerText);
    const bar = () => page.evaluate(() => { const b = [...document.querySelectorAll('button[aria-expanded]')].find((x) => /^Overview/.test(x.textContent.trim())); return b ? { expanded: b.getAttribute('aria-expanded'), text: b.innerText.replace(/\s+/g, ' ').trim(), h: b.getBoundingClientRect().height } : null; });
    const clickBar = async () => { await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded]')].find((x) => /^Overview/.test(x.textContent.trim())).click()); await wait(450); };
    const overviewMounted = () => page.evaluate(() => Boolean(document.getElementById('stock-overview')));
    const inView = () => page.evaluate(() => Number((document.body.innerText.match(/([\d,]+) items?(?: · -?₹[\d.,]+(?: L| Cr)?)? in view/) || [, '0'])[1].replace(/,/g, '')));

    // closed on arrival
    let b = await bar();
    check(`${label}: an Overview bar is there, closed`, b && b.expanded === 'false', b && `${b.text.slice(0, 60)} · ${Math.round(b.h)}px`);
    check(`${label}: nothing of the overview is in the DOM while closed`, !(await overviewMounted()) && !(await page.$('.label')));
    const t = await text();
    check(`${label}: no tiles, brands or insights on screen`, !/Stock by brand|Quick insights|Health score|Total items/.test(t));
    check(`${label}: the bar ${viewport.width > 767 ? 'says Show and ' : ''}carries the three counts`, (viewport.width > 767 ? /Show/.test(b.text) : !/Show/.test(b.text)) && /in stock/.test(b.text) && /low/.test(b.text) && /out/.test(b.text), b.text);
    if (viewport.width > 767) check(`${label}: the bar carries the health score on a laptop`, /health \d+%/.test(b.text));
    else check(`${label}: the bar leaves the health score off on a phone`, !/health/.test(b.text));
    check(`${label}: nothing in the closed bar is cut off`, await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded] .truncate')].every((e) => e.scrollWidth <= e.clientWidth + 1)));

    // one click opens
    await clickBar();
    b = await bar();
    check(`${label}: one click opens it`, b.expanded === 'true' && await overviewMounted());
    const open = await text();
    check(`${label}: tiles, brands and insights are all there`, /Total items/i.test(open) && /In stock/i.test(open) && /Health score/i.test(open) && /Stock by brand/.test(open) && /Quick insights/.test(open));
    check(`${label}: the bar now says Hide`, (viewport.width > 767 ? /Hide/.test(b.text) : !/Hide/.test(b.text)) && /Each tile is a filter/.test(b.text), b.text);
    check(`${label}: nothing in the bar is cut off`, await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded] .truncate')].every((e) => e.scrollWidth <= e.clientWidth + 1)));
    const counts = await page.evaluate(() => { const n = (l) => Number([...document.querySelectorAll('button, div')].find((x) => x.querySelector(':scope > span > .label')?.textContent.trim() === l)?.querySelector('.num')?.textContent.replace(/,/g, '')); return { total: n('Total items'), inS: n('In stock'), low: n('Low stock'), out: n('Out of stock') }; });
    check(`${label}: the tiles add up`, counts.inS + counts.low + counts.out === counts.total && counts.total > 1000, JSON.stringify(counts));
    const barCounts = (b.text.match(/[\d,]+/g) || []).map((x) => Number(x.replace(/,/g, '')));
    await page.screenshot({ path: path.join(OUT, `overview-open-${label}.png`) });

    // one click closes, and what was in the bar matched the tiles
    await clickBar();
    b = await bar();
    check(`${label}: one click closes it again`, b.expanded === 'false' && !(await overviewMounted()));
    const closedCounts = (b.text.match(/[\d,]+/g) || []).map((x) => Number(x.replace(/,/g, '')));
    check(`${label}: the closed bar's counts are the tiles' counts`, closedCounts[0] === counts.inS && closedCounts[1] === counts.low && closedCounts[2] === counts.out, closedCounts.join(', '));
    await page.screenshot({ path: path.join(OUT, `overview-closed-${label}.png`) });

    // the critical filter without opening anything
    if (viewport.width <= 767) { await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^Filters/.test(x.textContent.trim())).click()); await wait(300); }
    const total = await inView();
    const critText = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].find((x) => /^Critical \(\d+\)$/.test(x.textContent.trim()))?.textContent.trim());
    check(`${label}: a Critical chip sits in the filter row`, Boolean(critText), critText);
    const critical = Number((critText || '').match(/\d+/)?.[0]);
    await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].find((x) => /^Critical \(\d+\)$/.test(x.textContent.trim())).click()); await wait(400);
    check(`${label}: Critical chip → ${critical} in view`, (await inView()) === critical, String(await inView()));
    await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].find((x) => /^Critical \(\d+\)$/.test(x.textContent.trim())).click()); await wait(400);
    check(`${label}: Critical chip toggles off`, (await inView()) === total, String(await inView()));

    // keyboard: it is a real button
    await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded]')].find((x) => /^Overview/.test(x.textContent.trim())).focus());
    await page.keyboard.press('Enter'); await wait(400);
    check(`${label}: Enter on the bar opens it`, await overviewMounted());
    await page.keyboard.press('Enter'); await wait(400);
    check(`${label}: Enter again closes it`, !(await overviewMounted()));

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
