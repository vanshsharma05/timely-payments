/**
 * Works out replacement values for the palette entries that fail WCAG AA.
 * Darkens each failing colour in small steps until it clears the threshold on
 * every surface it is actually used on, keeping its hue.
 */
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase()).join('');
const lum = ([r, g, b]) => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const L1 = lum(a), L2 = lum(b);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};

const WHITE = hex('#FFFFFF');
const BG = hex('#F1F3F7');
const CARD2 = hex('#F6F7FA');
const TINT = hex('#E7F0FE');
// the tinted containers the ink tones actually sit on
const SURF = ['#F6EEEC','#FBE7EA','#F8D5C6','#FCF1DA','#F4F2EE','#FCEAE2','#F7F2E6','#EDEFF4'].map(hex);

/** Scale a colour toward black until it passes `need` on every surface. */
function darkenUntil(start, surfaces, need) {
  let c = hex(start);
  for (let i = 0; i < 200; i++) {
    if (surfaces.every(s => ratio(c, s) >= need)) return toHex(c);
    c = c.map(v => v * 0.98);
  }
  return toHex(c);
}

const targets = [
  ['--label-3', '#6B6E76', [WHITE, BG, CARD2, ...SURF], 4.5],
  ['--pos',     '#0F7D57', [WHITE, BG, CARD2, ...SURF], 4.5],
  ['--warn',    '#9A630A', [WHITE, BG, CARD2, ...SURF], 4.5],
  ['--dang',    '#CE2B41', [WHITE, BG, CARD2, ...SURF], 4.5],
  ['--age-2-ink','#9A630A', [WHITE, BG, CARD2, ...SURF], 4.5],
  ['--age-3-ink','#BC4929', [WHITE, BG, CARD2, ...SURF], 4.5],
  ['--age-4-ink','#CE2B41', [WHITE, BG, CARD2, ...SURF], 4.5],
  ['--accent',  '#0A66DC', [WHITE, BG, CARD2, TINT, ...SURF], 4.5],
];

console.log('token        current   on-white  on-bg   on-tint   ->  suggested   new-white new-bg');
for (const [name, cur, surfaces, need] of targets) {
  const c = hex(cur);
  const next = darkenUntil(cur, surfaces, need);
  const n = hex(next);
  console.log(
    name.padEnd(12),
    cur,
    String(ratio(c, WHITE).toFixed(2)).padStart(8),
    String(ratio(c, BG).toFixed(2)).padStart(7),
    String(ratio(c, TINT).toFixed(2)).padStart(8),
    '  -> ',
    next,
    String(ratio(n, WHITE).toFixed(2)).padStart(8),
    String(ratio(n, BG).toFixed(2)).padStart(7),
    cur === next ? '  (already passes)' : ''
  );
}

// White text on the accent fill — the primary button
console.log('\nwhite text on accent fill:');
for (const a of ['#0B6FEE', '#0A62D6', '#0959C4', '#0B5FCC']) {
  console.log('  ', a, ratio(WHITE, hex(a)).toFixed(2));
}
