// Built-in storage, used when DATABASE_URL is not set: Bun's SQLite with an FTS5 index (porter stemming, bm25 ranking).
// Nothing to sign up for. With the default path (:memory:) everything lives in the process: the starter pages are
// loaded again on each start, and pages added with POST /docs and chat history last until the next restart.
// Set HELPDOCK_SQLITE_PATH to a file on a persistent disk to keep them.
import { Database } from 'bun:sqlite';
import { chunkMarkdown, ftsQuery, nameBoost, type SearchHit } from './docs';
import { docPriority, htmlToMarkdown } from './github';
import type { Checkpoint, Stores } from './store';

export function createSqliteStores(path: string): Stores {
  const db = new Database(path, { create: true });
  // text is what is searched (HTML reduced to its text); body is the section's Markdown as written, for display.
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS help_docs
          USING fts5(title, section, text, body UNINDEXED, source UNINDEXED, tokenize = 'porter unicode61')`);
  db.run(`CREATE TABLE IF NOT EXISTS flisk_agent_sessions (
            session_id TEXT PRIMARY KEY,
            messages TEXT NOT NULL,
            updated_at TEXT NOT NULL)`);

  const replacePage = db.transaction((source: string, rows: ReturnType<typeof chunkMarkdown>) => {
    db.run('DELETE FROM help_docs WHERE source = ?', source);
    for (const r of rows) {
      db.run(
        'INSERT INTO help_docs (title, section, text, body, source) VALUES (?, ?, ?, ?, ?)',
        r.title,
        r.section,
        htmlToMarkdown(r.body),
        r.body,
        source,
      );
    }
  });

  // One transaction for a whole batch: FTS5 writes are far cheaper together than one transaction per page.
  const replacePages = db.transaction((pages: Array<{ source: string; rows: ReturnType<typeof chunkMarkdown> }>) => {
    for (const p of pages) replacePage(p.source, p.rows);
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
        // Title and section weigh ten times the body, like the A and B weights of the Postgres index. Three times the
        // hits are ranked again with the file's docPriority, so user docs come before contributor notes and examples.
        const hits = db
          .query<SearchHit>(
            `SELECT rowid AS id, source, title, section, body,
                    snippet(help_docs, 2, '<b>', '</b>', ' … ', 48) AS snippet,
                    -bm25(help_docs, 10.0, 10.0, 1.0, 0.0, 0.0) AS rank
             FROM help_docs WHERE help_docs MATCH ?
             ORDER BY rank DESC LIMIT ?`,
          )
          .all(match, limit * 6);
        // A stub ("See Proxy.") answers nothing on its own: sections under 80 characters count for half.
        // Then a page whose own name is the question's topic (middleware.mdx for "add middleware") comes first.
        const boost = (h: SearchHit) =>
          h.rank *
          (1 + 0.12 * Math.max(-4, Math.min(6, docPriority(h.source)))) *
          ((h.body?.length ?? 80) < 80 ? 0.5 : 1) *
          nameBoost(h, query);
        return hits
          .map((h) => ({ h, score: boost(h) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(({ h }) => h);
      },
      async upsert(source: string, markdown: string) {
        const rows = chunkMarkdown(source, markdown);
        replacePage(source, rows);
        return rows.length;
      },
      async upsertMany(pages: Array<{ source: string; markdown: string }>) {
        const chunked = pages.map((p) => ({ source: p.source, rows: chunkMarkdown(p.source, p.markdown) }));
        replacePages(chunked);
        return chunked.reduce((n, p) => n + p.rows.length, 0);
      },
      async count() {
        return db.query<{ n: number }>('SELECT count(*) AS n FROM help_docs').get()?.n ?? 0;
      },
      async pages() {
        return db
          .query<{ source: string; title: string; sections: number; lead: string }>(
            `SELECT source, min(title) AS title, count(*) AS sections,
                    (SELECT substr(body, 1, 1200) FROM help_docs l WHERE l.source = h.source ORDER BY rowid LIMIT 1) AS lead
             FROM help_docs h GROUP BY source ORDER BY source`,
          )
          .all();
      },
      async page(source: string) {
        const rows = db
          .query<{ title: string; section: string; body: string }>(
            'SELECT title, section, body FROM help_docs WHERE source = ? ORDER BY rowid',
          )
          .all(source);
        return rows.length > 0 ? { source, title: rows[0].title, sections: rows.map((r) => ({ section: r.section, body: r.body })) } : null;
      },
    },
  };
}
