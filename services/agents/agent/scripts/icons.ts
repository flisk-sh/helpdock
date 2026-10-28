// Renders brand/*.svg into the icons and the social card, and writes them into src/assets.generated.ts. Run it after
// changing a source SVG:
//   bun run icons
// The files are embedded in the code because Flisk's image (and any `tsc` build) ships src/ alone. resvg draws the
// text with the fonts installed on this machine; the output is committed, so the app never renders anything.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const here = new URL('..', import.meta.url).pathname;
const brand = (f: string) => join(here, 'brand', f);
const OUT = join(here, 'src', 'assets.generated.ts');

/** One SVG drawn `width` pixels wide (height follows its viewBox), as a PNG. */
function render(svgFile: string, width: number): Uint8Array {
  const svg = readFileSync(brand(svgFile), 'utf8');
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
  })
    .render()
    .asPng();
}

/** An ICO that holds PNG images, which every current browser reads. */
function ico(pngs: { size: number; data: Uint8Array }[]): Uint8Array {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => Buffer.from(p.data))]);
}

const TYPES: Record<string, string> = { ico: 'image/x-icon', svg: 'image/svg+xml', png: 'image/png' };

const files: Record<string, Uint8Array> = {
  'favicon.ico': ico([16, 32, 48].map((size) => ({ size, data: render('icon.svg', size) }))),
  'icon.svg': readFileSync(brand('icon.svg')),
  'apple-touch-icon.png': render('icon-full.svg', 180),
  'icon-192.png': render('icon.svg', 192),
  'icon-512.png': render('icon.svg', 512),
  'icon-maskable-512.png': render('icon-full.svg', 512),
  'og.png': render('og.svg', 1200),
};
const entries = Object.entries(files).map(
  ([name, data]) =>
    `  '${name}': {\n    type: '${TYPES[name.split('.').pop() as string]}',\n    base64:\n      '${Buffer.from(data).toString('base64')}',\n  },`,
);
writeFileSync(
  OUT,
  `// Written by \`bun run icons\` from brand/*.svg. Do not edit.\nexport const ASSETS: Record<string, { type: string; base64: string }> = {\n${entries.join('\n')}\n};\n`,
);
console.log(`Wrote ${Object.keys(files).join(', ')} into src/assets.generated.ts`);
