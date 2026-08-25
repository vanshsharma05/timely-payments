/**
 * Finds Tailwind utility classes used in source that produced no CSS.
 *
 * Tailwind only emits a rule for a class it recognises. If a class appears in
 * a component but nowhere in the built stylesheet, it silently does nothing —
 * which is how an element ends up transparent, unpadded or unstyled with no
 * error anywhere. This is the main way a token rename breaks a screen.
 */
const fs = require('fs');
const path = require('path');

const PREFIXES = [
  'bg', 'text', 'border', 'ring', 'divide', 'shadow', 'from', 'to', 'via',
  'fill', 'stroke', 'outline', 'placeholder', 'caret', 'decoration',
  'rounded', 'opacity', 'backdrop', 'gap', 'space', 'z', 'order',
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'w', 'h', 'size', 'min', 'max', 'basis', 'grid', 'col', 'row',
  'tracking', 'leading', 'font', 'inset', 'top', 'bottom', 'left', 'right',
];

const cssFile = fs.readdirSync('dist/assets').find(f => f.endsWith('.css'));
if (!cssFile) throw new Error('no built css — run npm run build first');
const css = fs.readFileSync(path.join('dist/assets', cssFile), 'utf8');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'scripts', '.smoke-shots', 'styles'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})('.');

/** A class token: optional variant prefixes, then <prefix>-<value>. */
const TOKEN = new RegExp(
  String.raw`^(?:[a-z][a-z0-9-]*:)*(?:${PREFIXES.join('|')})-\S+$`
);

const seen = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // split on everything that cannot appear inside a class name
  for (const tok of src.split(/[\s"'`{}()<>=;,]+/)) {
    if (!tok || !TOKEN.test(tok)) continue;
    if (!seen.has(tok)) seen.set(tok, new Set());
    seen.get(tok).add(f);
  }
}

/** Tailwind escapes these characters in the emitted selector. */
const esc = c => c.replace(/[:\/.\[\]%,#!]/g, ch => '\\' + ch);

const SKIP = /^(text|bg|border|fill|stroke|divide|ring|outline|placeholder|decoration|shadow|from|to|via)-(white|black|transparent|current|inherit|none)$/;

const dead = [];
for (const [cls, where] of seen) {
  const base = cls.replace(/^(?:[a-z][a-z0-9-]*:)*/, '');
  if (SKIP.test(base)) continue;
  if (css.includes('.' + esc(cls))) continue;
  dead.push({ cls, where: [...where] });
}

dead.sort((a, b) => b.where.length - a.where.length || a.cls.localeCompare(b.cls));
if (dead.length === 0) {
  console.log('No dead utility classes — every class in source produced CSS.');
} else {
  console.log(`DEAD CLASSES (produce no CSS): ${dead.length}\n`);
  for (const d of dead) {
    console.log(`  ${d.cls.padEnd(34)} ${d.where.map(w => path.basename(w)).join(', ')}`);
  }
}
process.exit(dead.length ? 1 : 0);
