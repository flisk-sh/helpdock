// Built-in storage, used when DATABASE_URL is not set: Bun's SQLite with an FTS5 index (porter stemming, bm25 ranking).
// Nothing to sign up for. With the default path (:memory:) everything lives in the process: the starter pages are
// loaded again on each start, and pages added with POST /docs and chat history last until the next restart.
// Set HELPDOCK_SQLITE_PATH to a file on a persistent disk to keep them.
import { Database } from 'bun:sqlite';
import { chunkMarkdown, ftsQuery, type SearchHit } from './docs';
import type { Checkpoint, Stores } from './store';

export function createSqliteStores(path: string): Stores {
  const db = new Database(path, { create: true });
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS help_docs
          USING fts5(title, section, body, source UNINDEXED, tokenize = 'porter unicode61')`);
  db.run(`CREATE TABLE IF NOT EXISTS flisk_agent_sessions (
            session_id TEXT PRIMARY KEY,
            messages TEXT NOT NULL,
            updated_at TEXT NOT NULL)`);

  const replacePage = db.transaction((source: string, rows: ReturnType<typeof chunkMarkdown>) => {
    db.run('DELETE FROM help_docs WHERE source = ?', source);
    for (const r of rows) {
      db.run('INSERT INTO help_docs (title, section, body, source) VALUES (?, ?, ?, ?)', r.title, r.section, r.body, source);
    }
  });

  return {
    store: {
      kind: 'sqlite',
      async ready() {
        return true;
      },
      async load(sessionId: string): Promise<Checkpoint> {
        const row = db
          .query<{ messages: string }>('SELECT messages FROM flisk_agent_sessions WHERE session_id = ?')
          .get(sessionId);
        return { sessionId, messages: row ? JSON.parse(row.messages) : [] };
      },
      async save(checkpoint: Checkpoint) {
        db.run(
          `INSERT INTO flisk_agent_sessions (session_id, messages, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (session_id) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at`,
          checkpoint.sessionId,
          JSON.stringify(checkpoint.messages),
          new Date().toISOString(),
        );
      },
      async close() {
        db.close();
      },
    },
    docs: {
      async search(query: string, limit = 5): Promise<SearchHit[]> {
        const match = ftsQuery(query);
        if (!match) return [];
        // Title and section weigh ten times the body, like the A and B weights of the Postgres index.
        return db
          .query<SearchHit>(
            `SELECT rowid AS id, source, title, section,
                    snippet(help_docs, 2, '<b>', '</b>', ' … ', 48) AS snippet,
                    -bm25(help_docs, 10.0, 10.0, 1.0) AS rank
             FROM help_docs WHERE help_docs MATCH ?
             ORDER BY rank DESC LIMIT ?`,
          )
          .all(match, limit);
      },
      async upsert(source: string, markdown: string) {
        const rows = chunkMarkdown(source, markdown);
        replacePage(source, rows);
        return rows.length;
      },
      async count() {
        return db.query<{ n: number }>('SELECT count(*) AS n FROM help_docs').get()?.n ?? 0;
      },
    },
  };
}
