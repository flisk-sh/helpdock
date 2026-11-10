// A repository can say which of its files are user docs and in what order, in an optional `.helpdock.json` at the
// top of the help center's folder (the folder of a /tree/<branch>/<folder> link, else the repository root):
//
//   {
//     "include": ["**"],
//     "exclude": ["drafts/**", "internal/**"],
//     "groups": [
//       { "name": "Get started", "pages": ["quickstart.md", "install/*.md"] },
//       { "name": "Guides", "pages": ["guides/**"] }
//     ],
//     "start": ["quickstart.md", "install/npm.md"],
//     "questions": ["Do we need Kubernetes?", "How do I use it in CI?"]
//   }
//
//   include  globs of the pages to show; without it, every page Helpdock finds
//   exclude  globs of pages to leave out of the page list, the search index and the MCP server
//   groups   named sections of the page list, in this order; a page goes to the first group with a matching glob and
//            is placed by the first glob it matches, then by path. Pages in no group come after them
//   start    the pages a newcomer reads first ("Start here" cards), in order; without it, the first group's pages
//   questions  the questions offered under the question box and typed as its placeholder, in order; without it, the
//            start pages' titles
//
// Paths and globs are relative to that folder: `*` matches within one folder, `**` across folders, and a folder name
// means everything in it. The file is read once per listing from raw.githubusercontent.com (no API call); a missing
// or broken file means Helpdock's defaults (translations, drafts, release notes and tooling folders left out).

export const CONFIG_FILE = '.helpdock.json';

export interface ConfigGroup {
  name: string;
  pages: string[];
}

export interface HelpdockConfig {
  include: string[];
  exclude: string[];
  groups: ConfigGroup[];
  start: string[];
  questions: string[];
}

/** Where a page goes in the page list: its group (index into `groups`) and its place in the whole list. */
export interface Placement {
  group: number;
  order: number;
}

const MAX_ENTRIES = 200;
const MAX_GROUPS = 30;
const MAX_ENTRY_CHARS = 300;
const MAX_START = 12;
const MAX_QUESTIONS = 12;
const MAX_QUESTION_CHARS = 120;

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_ENTRY_CHARS)
        .map((v) => v.trim().replace(/^\.?\//, ''))
        .slice(0, MAX_ENTRIES)
    : [];

/** The settings in a `.helpdock.json`, or null when there is no file or it is not a JSON object. */
export function parseConfig(text: string | null): HelpdockConfig | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const groups = (Array.isArray(obj.groups) ? obj.groups : [])
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object' && typeof (g as Record<string, unknown>).name === 'string')
    .map((g) => ({ name: String(g.name).trim().slice(0, 80), pages: strings(g.pages) }))
    .filter((g) => g.name && g.pages.length > 0)
    .slice(0, MAX_GROUPS);
  const questions = (Array.isArray(obj.questions) ? obj.questions : [])
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.replace(/\s+/g, ' ').trim())
    .filter((q) => q.length > 0 && q.length <= MAX_QUESTION_CHARS)
    .slice(0, MAX_QUESTIONS);
  return { include: strings(obj.include), exclude: strings(obj.exclude), groups, start: strings(obj.start).slice(0, MAX_START), questions };
}

/** A glob as a regular expression over a whole path: `**` any folders, `*` within a folder, `?` one character. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // "**/" matches no folder too: docs/**/x.md matches docs/x.md.
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A folder ("drafts/" or "drafts") also means everything in it.
  return new RegExp(`^${out.replace(/\/$/, '')}(?:/.*)?$`);
}

const byPath = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * The listing with the settings applied: pages outside `include` or inside `exclude` dropped, each remaining page's
 * group and place, and the `start` pages that exist, in order. `scope` is the help center's folder: config paths are
 * relative to it, listing paths are not.
 */
export function applyConfig<T extends { path: string }>(
  paths: T[],
  config: HelpdockConfig | null,
  scope?: string,
): { paths: T[]; start: string[]; groups: string[]; questions: string[]; placement: Map<string, Placement> } {
  const placement = new Map<string, Placement>();
  if (!config) return { paths, start: [], groups: [], questions: [], placement };
  const rel = (p: string) => (scope && p.startsWith(`${scope}/`) ? p.slice(scope.length + 1) : p);
  const include = config.include.map(globToRegExp);
  const exclude = config.exclude.map(globToRegExp);
  const kept = paths.filter((p) => {
    const r = rel(p.path);
    return (include.length === 0 || include.some((re) => re.test(r))) && !exclude.some((re) => re.test(r));
  });

  // Each page in the first group that matches it, ranked by the first glob of that group it matches.
  const groupRes = config.groups.map((g) => g.pages.map(globToRegExp));
  const members: Array<Array<{ path: string; rank: number }>> = config.groups.map(() => []);
  for (const p of kept) {
    const r = rel(p.path);
    for (const [gi, res] of groupRes.entries()) {
      const rank = res.findIndex((re) => re.test(r));
      if (rank >= 0) {
        members[gi].push({ path: p.path, rank });
        break;
      }
    }
  }
  let order = 0;
  for (const [gi, list] of members.entries()) {
    list.sort((a, b) => a.rank - b.rank || byPath(a.path, b.path));
    for (const m of list) placement.set(m.path, { group: gi, order: order++ });
  }

  const byRel = new Map(kept.map((p) => [rel(p.path), p.path]));
  const start: string[] = [];
  for (const s of config.start) {
    const full = byRel.get(s);
    if (full && !start.includes(full)) start.push(full);
  }
  if (config.start.length === 0) start.push(...(members[0] ?? []).slice(0, 6).map((m) => m.path));
  return { paths: kept, start, groups: config.groups.map((g) => g.name), questions: config.questions, placement };
}
