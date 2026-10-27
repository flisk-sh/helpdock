// Postgres storage: tables created by agent-migrator (prisma/migrations), full-text search with websearch_to_tsquery.
import { Pool } from 'pg';
import { chunkMarkdown, type SearchHit } from './docs';
import type { Checkpoint, Stores } from './store';

export function createPostgresStores(databaseUrl: string): Stores {
  // A pool, so concurrent requests never share a connection (an ingest transaction would otherwise take other
  // requests' queries with it).
  const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.HELPDOCK_DB_POOL || 10) });
  pool.on('error', (err) => console.error('[agent] idle Postgres connection failed:', err.message));

  return {
    store: {
      kind: 'postgres',
      async ready() {
        try {
          await pool.query('SELECT 1');
          return true;
        } catch {
          return false;
        }
      },
      async load(sessionId: string): Promise<Checkpoint> {
        try {
          const res = await pool.query('SELECT messages FROM flisk_agent_sessions WHERE session_id = $1', [sessionId]);
          if (res.rows.length > 0 && res.rows[0].messages) return { sessionId, messages: res.rows[0].messages };
          return { sessionId, messages: [] };
        } catch (err) {
          console.error('[agent] load checkpoint failed:', err);
          return { sessionId, messages: [] };
        }
      },
      async save(checkpoint: Checkpoint) {
        await pool.query(
          `INSERT INTO flisk_agent_sessions (session_id, messages, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (session_id) DO UPDATE
           SET messages = EXCLUDED.messages, updated_at = NOW()`,
          [checkpoint.sessionId, JSON.stringify(checkpoint.messages)],
        );
      },
      async close() {
        try {
          await pool.end();
        } catch (err) {
          console.warn('[agent] closing the Postgres pool failed:', err);
        }
      },
    },
    docs: {
      async search(query: string, limit = 5): Promise<SearchHit[]> {
        const res = await pool.query(
          `SELECT id, source, title, section, body,
                  ts_headline('english', body, q, 'MaxWords=60, MinWords=25, MaxFragments=2, FragmentDelimiter=" … "') AS snippet,
                  ts_rank(search, q) AS rank
           FROM help_docs, websearch_to_tsquery('english', $1) q
           WHERE search @@ q
           ORDER BY rank DESC
           LIMIT $2`,
          [query, limit],
        );
        return res.rows.map((r) => ({ ...r, id: Number(r.id), rank: Number(r.rank) }));
      },
      async upsert(source: string, markdown: string) {
        const chunks = chunkMarkdown(source, markdown);
        const c = await pool.connect();
        await c.query('BEGIN');
        try {
          await c.query('DELETE FROM help_docs WHERE source = $1', [source]);
          for (const ch of chunks) {
            await c.query('INSERT INTO help_docs (source, title, section, body) VALUES ($1, $2, $3, $4)', [
              ch.source,
              ch.title,
              ch.section,
              ch.body,
            ]);
          }
          await c.query('COMMIT');
        } catch (err) {
          await c.query('ROLLBACK');
          throw err;
        } finally {
          c.release();
        }
        return chunks.length;
      },
      async count() {
        const res = await pool.query('SELECT count(*)::int AS n FROM help_docs');
        return res.rows[0].n;
      },
      async pages() {
        const res = await pool.query(
          'SELECT source, min(title) AS title, count(*)::int AS sections FROM help_docs GROUP BY source ORDER BY source',
        );
        return res.rows;
      },
      async page(source: string) {
        const res = await pool.query('SELECT title, section, body FROM help_docs WHERE source = $1 ORDER BY id', [source]);
        return res.rows.length > 0
          ? { source, title: res.rows[0].title, sections: res.rows.map((r) => ({ section: r.section, body: r.body })) }
          : null;
      },
    },
  };
}
