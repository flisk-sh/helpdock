import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedPages } from '../src/seed-docs.generated';

// src/seed-docs.generated.ts is packed from seed-docs/*.md by scripts/pack-seed-docs.ts. If this fails, run
// `bun run seed:pack` in services/agents/agent and commit the result. Do not edit the generated file by hand.
const dir = join(import.meta.dirname, '..', 'seed-docs');
const onDisk = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
);

describe('packed seed docs', () => {
  it('lists the same pages as seed-docs/', () => {
    expect(Object.keys(seedPages).sort()).toEqual(Object.keys(onDisk));
  });

  it.each(Object.keys(onDisk))('%s matches its packed copy (run `bun run seed:pack` if not)', (name) => {
    expect(seedPages[name]).toBe(onDisk[name]);
  });
});
