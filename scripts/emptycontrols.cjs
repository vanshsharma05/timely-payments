/**
 * Finds elements whose visible content is empty.
 *
 * Removing decorative glyphs can leave a control with nothing inside it — the
 * button still exists and still works, but it is invisible and roughly the size
 * of its own padding. Nothing errors, so only a scan like this catches it.
 *
 * Scanned line-by-line on purpose: JSX attributes routinely contain ">" (arrow
 * functions), which defeats any "<tag ...>" regex.
 */
const fs = require('fs');
const path = require('path');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'scripts', '.smoke-shots'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})('.');

/** Tags that must have visible content to be usable. */
const MUST_HAVE_CONTENT = new Set(['button', 'a', 'label', 'h1', 'h2', 'h3', 'h4', 'th']);

const findings = [];

for (const f of files) {
  const L = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  for (let i = 0; i < L.length; i++) {
    const close = L[i].match(/^\s*<\/([a-zA-Z][\w.]*)>\s*$/);
    if (!close) continue;
    const tag = close[1].toLowerCase();
    if (!MUST_HAVE_CONTENT.has(tag)) continue;

    // walk back over blank / whitespace-only lines
    let j = i - 1;
    let blanks = 0;
    while (j >= 0 && L[j].trim() === '') { blanks++; j--; }
    if (j < 0) continue;

    // the element is empty if the preceding content line closes an opening tag
    if (/>\s*$/.test(L[j]) && !/\/>\s*$/.test(L[j]) && !/<\/[a-zA-Z]/.test(L[j])) {
      findings.push({ f, line: i + 1, tag, blanks, context: L[j].trim().slice(0, 70) });
    }
  }
}

if (!findings.length) {
  console.log('No empty controls.');
} else {
  console.log(`EMPTY CONTROLS: ${findings.length}\n`);
  for (const x of findings) {
    console.log(`  ${path.basename(x.f)}:${x.line}  <${x.tag}> is empty  (after: ${x.context})`);
  }
}
process.exit(findings.length ? 1 : 0);
