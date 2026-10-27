// The part of Bun's built-in SQLite (bun:sqlite) that store-sqlite.ts uses. Declared here because both tsconfigs, this
// one and the one Flisk generates for the image, load only the Node types.
declare module 'bun:sqlite' {
  export class Database {
    constructor(filename?: string, options?: { create?: boolean; strict?: boolean });
    run(sql: string, ...params: unknown[]): void;
    query<Row = Record<string, unknown>>(
      sql: string,
    ): { all(...params: unknown[]): Row[]; get(...params: unknown[]): Row | null };
    transaction<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
    close(): void;
  }
}
