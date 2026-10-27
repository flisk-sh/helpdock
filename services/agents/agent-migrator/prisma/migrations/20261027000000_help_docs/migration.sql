-- Help center articles, one row per section of a Markdown page. The search column is kept by Postgres, so a
-- question is answered with full-text search and no embedding model or extension.
create table if not exists help_docs (
  id bigserial primary key,
  source varchar(512) not null,
  title text not null,
  section text not null default '',
  body text not null,
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', title || ' ' || section), 'A') || setweight(to_tsvector('english', body), 'B')
  ) stored,
  unique (source, section)
);

create index if not exists help_docs_search_idx on help_docs using gin (search);
