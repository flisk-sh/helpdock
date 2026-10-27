// Packs seed-docs/*.md into src/seed-docs.generated.ts. The Flisk image builds src/ and ships only dist/, so the
// starter pages must be compiled in. Run `bun run seed:pack` after changing seed-docs/.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'seed-docs');
const pages = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
);
writeFileSync(
  join(import.meta.dirname, '..', 'src', 'seed-docs.generated.ts'),
  '// Written by scripts/pack-seed-docs.ts from seed-docs/. Edit the Markdown and run `bun run seed:pack`.\n' +
    `export const seedPages: Record<string, string> = ${JSON.stringify(pages, null, 2)};\n`,
);
console.log(`packed ${Object.keys(pages).length} pages`);
