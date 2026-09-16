const path = require('path');
const puppeteer = require(path.join(process.cwd(), 'node_modules', 'puppeteer-core'));
const { signIn } = require(path.join(process.cwd(), 'scripts', 'signin.cjs'));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

    const tap = (text) => page.evaluate((t) => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === t);
        if (!b) return false; b.click(); return true;
    }, text);
    const tapAria = (label) => page.evaluate((l) => {
        const b = document.querySelector(`[aria-label="${l}"]`) || [...document.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label').startsWith(l));
        if (!b) return false; b.click(); return true;
    }, label);
    const visible = (text) => page.evaluate((t) => document.body.innerText.includes(t), text);
    const h1 = () => page.$eval('h1', (e) => e.textContent.trim());
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => localStorage.setItem('timely_theme', 'light'));
    await signIn(page);
    await wait(2000);

    /* ---- shell ---- */
    check('shell: pill row hidden, tab bar present', await page.evaluate(() => {
        const navs = [...document.querySelectorAll('nav[aria-label="Sections"]')];
        const shown = navs.filter((n) => getComputedStyle(n).display !== 'none');
        return navs.length === 2 && shown.length === 1 && getComputedStyle(shown[0]).position === 'fixed';
    }));
    check('shell: sync + theme not in the app bar', await page.evaluate(() =>
        [...document.querySelectorAll('header button')].every((b) => !/Sync balances|Switch to/.test(b.getAttribute('aria-label') || '') || getComputedStyle(b).display === 'none' || b.closest('.max-md\\:hidden'))));
    for (const [label, title] of [['Customers', 'Customer book'], ['Cheques', 'Post-dated cheques'], ['Reports', 'Reports'], ['Today', 'Collections overview']]) {
        await page.evaluate((t) => {
            const bar = [...document.querySelectorAll('nav[aria-label="Sections"]')].find((n) => getComputedStyle(n).position === 'fixed');
            [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').trim().replace(/^[0-9+]+|[0-9+]+$/g, '').trim() === t).click();
        }, label);
        await wait(700);
        check(`tab bar: ${label} → "${await h1()}"`, (await h1()) === title);
    }
    await page.evaluate(() => {
        const bar = [...document.querySelectorAll('nav[aria-label="Sections"]')].find((n) => getComputedStyle(n).position === 'fixed');
        [...bar.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Settings').click();
    });
    await wait(500);
    check('settings sheet opens', await page.evaluate(() => !!document.querySelector('[role="menu"] [role="menuitem"]')));
    await tap('Team & access'); await wait(800);
    check('settings sheet navigates and closes', (await h1()) === 'Team & access' && !(await page.evaluate(() => !!document.querySelector('.fixed.inset-0.z-50 [role="menu"]'))));
    check('team page: cards not table on phone', await page.evaluate(() => {
        const t = document.querySelector('table'); return !t || getComputedStyle(t.closest('div')).display === 'none';
    }));

    // avatar menu
    await page.evaluate(() => document.querySelector('header button[aria-haspopup="menu"]').click()); await wait(400);
    check('avatar menu: Sync balances + theme on phone', (await visible('Sync balances')) && (await visible('Dark mode')));
    await tap('Dark mode'); await wait(300);
    check('avatar menu: theme switches', await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'));
    await tap('Light mode'); await wait(300);
    await page.keyboard.press('Escape');

    /* ---- customers ---- */
    await page.goto('http://localhost:3000/#customers', { waitUntil: 'networkidle2' }); await wait(3000);
    check('customers: no table on phone', await page.evaluate(() => !document.querySelector('#customer-table-scroll-container')));
    check('customers: filters folded', !(await page.evaluate(() => {
        const s = document.querySelector('select[aria-label="Payment Rank"]'); return s && getComputedStyle(s.parentElement).display !== 'none';
    })));
    await tap('Filters'); await wait(300);
    check('customers: Filters button reveals the selects', await page.evaluate(() => {
        const s = document.querySelector('select[aria-label="Payment Rank"]'); return s && getComputedStyle(s.parentElement).display !== 'none';
    }));
    await tap('Hide filters'); await wait(200);
    const firstRow = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.querySelector('p') && /Next |No date/.test(x.textContent || ''));
        if (!b) return null; const name = b.querySelector('p').textContent.trim(); b.click(); return name;
    });
    await wait(1200);
    check('customers: row tap opens the follow-up sheet', !!firstRow && (await visible('Follow-up')) && (await visible('Activity')) && (await visible(firstRow)), firstRow);
    check('follow-up sheet: fills the screen', await page.evaluate(() => {
        const sheet = document.querySelector('.fixed.inset-0.z-50 > div'); const r = sheet.getBoundingClientRect();
        return Math.round(r.height) === window.innerHeight && Math.round(r.width) === window.innerWidth;
    }));
    check('follow-up sheet: form scroll area is tall', await page.evaluate(() => {
        const el = [...document.querySelectorAll('.overflow-y-auto')].find((e) => e.textContent.includes('TOTAL OUTSTANDING BALANCE') || e.textContent.includes('Total Outstanding Balance'));
        return el && el.getBoundingClientRect().height > 400;
    }));
    await tap('Activity'); await wait(400);
    check('follow-up sheet: Activity segment shows the record', (await visible('Account activity')) && (await page.evaluate(() => !document.body.innerText.includes('Save Follow-up & Contacts'))));
    await tap('Follow-up'); await wait(300);
    check('follow-up sheet: back to the form', await visible('Save Follow-up & Contacts'));
    await page.evaluate(() => document.querySelector('button[aria-label="Close"]').click()); await wait(400);
    check('follow-up sheet: closes', !(await visible('Save Follow-up & Contacts')));

    const wa = await tapAria('WhatsApp '); await wait(900);
    check('customers: WhatsApp icon opens the reminder', wa && (await visible('Send WhatsApp Reminder')));
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Close'); b && b.click(); }); await wait(300);

    await page.evaluate(() => { document.querySelector('input[aria-label="Select all customers in view"]').click(); }); await wait(500);
    check('customers: select all → bulk bar with Set follow-up (admin)', (await visible('selected')) && (await visible('Set follow-up')));
    await tap('Set follow-up'); await wait(500);
    check('customers: bulk confirm shown and dismissed', dialogs.length === 1 && /Set the follow-up date/.test(dialogs[0]));
    await tap('Clear');

    /* ---- reports ---- */
    await page.goto('http://localhost:3000/#reports', { waitUntil: 'networkidle2' }); await wait(3000);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Overdue \(/.test((b.textContent || '').trim())).click()); await wait(800);
    const rows = await page.evaluate(() => [...document.querySelectorAll('button')].filter((x) => x.querySelector('p') && /Next |No date/.test(x.textContent || '')).length);
    check('reports: overdue filter renders phone rows', rows > 0 && rows <= 50, `${rows} rows`);
    check('reports: no table on phone', await page.evaluate(() => ![...document.querySelectorAll('table')].some((t) => t.textContent.includes('Company / Contact'))));
    check('reports: Show more present when list is long', await page.evaluate(() => {
        [...document.querySelectorAll('button')].find((b) => /^All \(/.test((b.textContent || '').trim())).click(); return true;
    }) && (await wait(800), await visible('Show more')));

    /* ---- pdc ---- */
    await page.goto('http://localhost:3000/#pdc', { waitUntil: 'networkidle2' }); await wait(3000);
    check('pdc: cheque cards with quick actions', await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === 'Bounce').length > 0));
    check('pdc: no table on phone', await page.evaluate(() => !document.querySelector('table')));
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Add PDC Cheque/.test(b.textContent || '')).click()); await wait(800);
    check('pdc: add sheet shows its header at the top', await page.evaluate(() => {
        const h = [...document.querySelectorAll('h2, h3')].find((x) => /Add Post Dated Cheque/.test(x.textContent || ''));
        return h && h.getBoundingClientRect().top >= 0 && h.getBoundingClientRect().top < 120;
    }));
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^cancel$/i.test((x.textContent || '').trim())); b && b.click(); });

    /* ---- overflow sweep ---- */
    for (const tab of ['overview', 'customers', 'pdc', 'reports', 'users', 'alerts', 'templates', 'source']) {
        await page.goto(`http://localhost:3000/#${tab}`, { waitUntil: 'networkidle2' }); await wait(1500);
        check(`no horizontal overflow: ${tab}`, await noOverflow());
    }
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await browser.close();
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
