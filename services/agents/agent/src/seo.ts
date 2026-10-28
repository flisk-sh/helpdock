// Search, link previews and AI answers: the <head> of each page, JSON-LD, robots.txt, sitemap.xml, llms.txt,
// site.webmanifest, security.txt and the icons. Built from SITE and the address the site is served at.
import { ASSETS } from './assets.generated';

export const SITE = {
  name: 'Helpdock',
  tagline: "Any GitHub repo's docs as a help center and MCP server",
  description:
    "Replace github.com with helpdock.flisk.sh: search and browse any public repository's docs, get cited answers, and plug them into your own AI over MCP.",
  url: 'https://helpdock.flisk.sh/',
  repo: 'https://github.com/flisk-sh/helpdock',
  lang: 'en',
  locale: 'en_US',
  author: { name: 'Flisk', url: 'https://flisk.sh' },
  themeColor: { light: '#f6f5f1', dark: '#121312' },
  securityContact: 'https://github.com/flisk-sh/helpdock/security/advisories/new',
} as const;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The files the head and the manifest link to, from assets.generated.ts (`bun run icons`). */
export const ICONS = {
  ico: 'favicon.ico',
  svg: 'icon.svg',
  apple: 'apple-touch-icon.png',
  png192: 'icon-192.png',
  png512: 'icon-512.png',
  maskable: 'icon-maskable-512.png',
  og: 'og.png',
} as const;

export interface PageMeta {
  /** The page's path under the site, without the leading slash: "" for home, "vercel/next.js/". */
  path: string;
  /** Under 60 characters where possible. The site name is added after it, except on the home page. */
  title: string;
  /** Up to 160 characters. */
  description: string;
  noindex?: boolean;
  /** Extra JSON-LD nodes for this page. */
  jsonLd?: object[];
}

/** `base` is the site address without the trailing slash. */
export function head(base: string, page: PageMeta): string {
  const url = `${base}/${page.path}`;
  const title = page.path ? `${page.title} · ${SITE.name}` : page.title;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    page.noindex
      ? '<meta name="robots" content="noindex">'
      : '<meta name="robots" content="index,follow,max-image-preview:large">',
    `<meta name="theme-color" content="${SITE.themeColor.light}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${SITE.themeColor.dark}" media="(prefers-color-scheme: dark)">`,
    `<link rel="icon" href="/${ICONS.ico}" sizes="32x32">`,
    `<link rel="icon" href="/${ICONS.svg}" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="/${ICONS.apple}">`,
    '<link rel="manifest" href="/site.webmanifest">',
    '<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE.name}">`,
    `<meta property="og:locale" content="${SITE.locale}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:image" content="${esc(`${base}/${ICONS.og}`)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(`${SITE.name}: ${SITE.tagline}`)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<script type="application/ld+json">${jsonLd(base, page)}</script>`,
  ];
  return tags.join('\n');
}

/** One schema.org @graph: the WebSite, who makes it, the app itself, and the page's own nodes. */
export function jsonLd(base: string, page: PageMeta): string {
  const home = `${base}/`;
  const graph: object[] = [
    {
      '@type': 'WebSite',
      '@id': `${home}#website`,
      url: home,
      name: SITE.name,
      description: SITE.description,
      inLanguage: SITE.lang,
      publisher: { '@id': `${home}#publisher` },
    },
    {
      '@type': 'Organization',
      '@id': `${home}#publisher`,
      name: SITE.author.name,
      url: SITE.author.url,
      logo: `${base}/${ICONS.png512}`,
      sameAs: [SITE.repo],
    },
    {
      '@type': 'WebApplication',
      '@id': `${home}#app`,
      name: SITE.name,
      url: home,
      description: SITE.description,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Any',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      image: `${base}/${ICONS.og}`,
    },
    ...(page.jsonLd ?? []),
  ];
  // "</" would end the script element early; JSON allows the escaped form.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

/** The AI answer crawlers are named on purpose: naming them states the choice. The API stays out of the index. */
export const ANSWER_CRAWLERS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Googlebot', 'Bingbot'];

export function robotsTxt(base: string): string {
  const rules = 'Allow: /\nDisallow: /*/mcp\nDisallow: /*/turn\nDisallow: /*/search\nDisallow: /*/session\n';
  return `${ANSWER_CRAWLERS.map((ua) => `User-agent: ${ua}`).join('\n')}\n${rules}\nUser-agent: *\n${rules}\nSitemap: ${base}/sitemap.xml\n`;
}

export function sitemapXml(base: string, paths: string[], lastmod: string): string {
  const urls = paths.map((p) => `<url><loc>${esc(`${base}/${p}`)}</loc><lastmod>${lastmod}</lastmod></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
}

/** llms.txt (llmstxt.org): what the site is and how to use it, for AI assistants. */
export function llmsTxt(base: string, examples: string[]): string {
  return `# ${SITE.name}\n\n> ${SITE.description}\n\n## Use\n\n- Replace github.com with ${new URL(base).host} in any repository address: ${base}/vercel/next.js/\n- Each help center is also an MCP server (Streamable HTTP, no key): ${base}/vercel/next.js/mcp\n\n## Examples\n\n${examples.map((e) => `- [${e}](${base}/${e}/)`).join('\n')}\n\n## Optional\n\n- [Source](${SITE.repo})\n`;
}

export function webManifest(): string {
  return JSON.stringify(
    {
      name: SITE.name,
      short_name: SITE.name,
      description: SITE.description,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: SITE.themeColor.light,
      theme_color: SITE.themeColor.light,
      icons: [
        { src: `/${ICONS.png192}`, sizes: '192x192', type: 'image/png' },
        { src: `/${ICONS.png512}`, sizes: '512x512', type: 'image/png' },
        { src: `/${ICONS.maskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: `/${ICONS.svg}`, sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    null,
    2,
  );
}

/** RFC 9116. Expires must be less than a year ahead, so it is written for 180 days from `now`. */
export function securityTxt(base: string, now = new Date()): string {
  const expires = new Date(now.getTime() + 180 * 24 * 3600 * 1000);
  return `Contact: ${SITE.securityContact}\nExpires: ${expires.toISOString().replace(/\.\d+Z$/, 'Z')}\nPreferred-Languages: ${SITE.lang}\nCanonical: ${base}/.well-known/security.txt\n`;
}

/** The icons and the social card, decoded once, by path ("/og.png"). */
export const ASSET_FILES = new Map(
  Object.values(ICONS).map((name) => [`/${name}`, { body: Buffer.from(ASSETS[name].base64, 'base64'), type: ASSETS[name].type }]),
);
