/**
 * Shared sign-in for the QA scripts.
 *
 * The app authenticates against Supabase now, so these scripts need a real
 * account. Credentials come from .deploy.local (gitignored) or from
 * TIMELY_EMAIL / TIMELY_PASSWORD in the environment — never from source.
 */
const fs = require('fs');
const path = require('path');

function readEnvFile(file) {
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
}

function credentials() {
    const deploy = readEnvFile(path.join(process.cwd(), '.deploy.local'));
    const email = process.env.TIMELY_EMAIL || deploy.ADMIN_EMAIL;
    const password = process.env.TIMELY_PASSWORD || deploy.ADMIN_PASSWORD;
    if (!email || !password) {
        throw new Error(
            'No sign-in details. Set TIMELY_EMAIL and TIMELY_PASSWORD, or keep ADMIN_EMAIL / ADMIN_PASSWORD in .deploy.local.'
        );
    }
    return { email, password };
}

/**
 * Signs in and resolves once the dashboard has had time to hydrate. A session
 * restored from a previous run means there is nothing to sign in to, so this
 * returns quietly rather than waiting for a form that will never appear.
 */
async function signIn(page) {
    const { email, password } = credentials();
    const needsLogin = await page
        .waitForSelector('input#email', { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
    if (!needsLogin) {
        await new Promise((r) => setTimeout(r, 4000));
        return;
    }
    await page.type('input#email', email);
    await page.keyboard.press('Enter');
    await page.waitForSelector('input#pw', { timeout: 20000 });
    await page.type('input#pw', password);
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 11000));
}

module.exports = { signIn, credentials };
