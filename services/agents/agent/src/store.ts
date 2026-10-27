// Where Helpdock keeps its docs and sessions. Two implementations with the same shape:
//   store-postgres.ts  when DATABASE_URL is set (Flisk injects it locally; online, any Postgres such as Neon)
//   store-sqlite.ts    otherwise: Bun's built-in SQLite, so a deploy needs no database and no account
import type { Answer, SearchHit } from './docs';

export interface Checkpoint {
  sessionId: string;
  messages: Array<{ role: 'user' | 'agent'; content: string; at: string; sources?: Answer['sources'] }>;
}

export interface SessionStore {
  readonly kind: 'postgres' | 'sqlite';
  ready(): Promise<boolean>;
  load(sessionId: string): Promise<Checkpoint>;
  save(checkpoint: Checkpoint): Promise<void>;
  close(): Promise<void>;
}

export interface DocStore {
  search(query: string, limit?: number): Promise<SearchHit[]>;
  /** Adds or replaces every section of one page; returns the number of sections. */
  upsert(source: string, markdown: string): Promise<number>;
  count(): Promise<number>;
  /** Every page: its source path, title and number of sections, sorted by path. */
  pages(): Promise<Array<{ source: string; title: string; sections: number; lead: string }>>;
  /** One page's sections in order, or null when there is no such page. */
  page(source: string): Promise<{ source: string; title: string; sections: Array<{ section: string; body: string }> } | null>;
}

export interface Stores {
  store: SessionStore;
  docs: DocStore;
}
