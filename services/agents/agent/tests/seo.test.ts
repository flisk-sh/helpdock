import { describe, expect, it } from 'vitest';
import { scriptHash } from '../src/guard';
import { ASSET_FILES, head, ICONS, robotsTxt, SITE, sitemapXml } from '../src/seo';
import { centerPage, centerPageFor, indexable, landingPage } from '../src/ui';
import { VIDEO } from '../src/video.generated';

const attr = (html: string, re: RegExp) => html.match(re)?.[1];

describe('the head of each page', () => {
  const repo = centerPageFor({ path: 'vercel/next.js/', title: 'vercel/next.js docs', description: 'Search the vercel/next.js docs.' });

  it.each([
    ['landing', landingPage, 'https://helpdock.flisk.sh/'],
    ['repository', repo, 'https://helpdock.flisk.sh/vercel/next.js/'],
  ])('%s: one title, a canonical link, a social card and icons', (_, html, canonical) => {
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(attr(html, /<link rel="canonical" href="([^"]+)"/)).toBe(canonical);
    expect(attr(html, /<meta property="og:image" content="([^"]+)"/)).toBe('https://helpdock.flisk.sh/og.png');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<link rel="icon" href="/favicon.ico"');
    const ld = JSON.parse(attr(html, /<script type="application\/ld\+json">(.+?)<\/script>/s) as string);
    expect(ld['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(
      expect.arrayContaining(['WebSite', 'Organization', 'WebApplication']),
    );
  });

  it('lets search engines index the examples and no other repository', () => {
    expect(indexable('vercel/next.js/')).toBe(true);
    expect(indexable('hashicorp/web-unified-docs/tree/main/content/terraform/v1.17.x/docs/')).toBe(true);
    expect(indexable('someone/phish/')).toBe(false);
    expect(indexable('vercel/next.js/tree/canary/docs/')).toBe(false);
    const other = centerPageFor({ path: 'someone/phish/', title: 't', description: 'd', noindex: true });
    expect(other).toContain('<meta name="robots" content="noindex">');
    expect(scriptHash(other)).toBe(scriptHash(centerPage));
  });

  it('keeps the same script, so one CSP hash fits every repository', () => {
    expect(scriptHash(repo)).toBe(scriptHash(centerPage));
  });

  it('keeps the description at a length search results show whole', () => {
    expect(SITE.description.length).toBeLessThanOrEqual(160);
    expect(head('https://x.test', { path: '', title: 't', description: 'd' })).toContain('href="https://x.test/"');
  });
});

describe('files for crawlers', () => {
  it('robots.txt names the AI answer crawlers and points at the sitemap', () => {
    const robots = robotsTxt('https://helpdock.test');
    expect(robots).toContain('User-agent: Claude-SearchBot');
    expect(robots).toContain('Sitemap: https://helpdock.test/sitemap.xml');
    expect(sitemapXml('https://helpdock.test', ['', 'a/b/'], '2026-10-28')).toContain(
      '<loc>https://helpdock.test/a/b/</loc><lastmod>2026-10-28</lastmod>',
    );
  });

  it('ships every icon at its size', () => {
    for (const name of Object.values(ICONS)) expect(ASSET_FILES.get(`/${name}`)).toBeDefined();
    const og = ASSET_FILES.get('/og.png')?.body as Buffer;
    expect([og.readUInt32BE(16), og.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});

describe('how-it-works clip', () => {
  it('autoplays muted on the landing page, with controls for the narration and a still for reduced motion', () => {
    expect(landingPage).toContain('<video src="/demo.mp4" poster="/demo.jpg"');
    expect(landingPage).toContain('autoplay muted loop playsinline controls');
    expect(landingPage).toContain('prefers-reduced-motion: reduce');
    const mp4 = Buffer.from(VIDEO['demo.mp4'].base64, 'base64');
    expect(mp4.subarray(4, 8).toString()).toBe('ftyp');
    // the narration: an AAC track, which the controls unmute
    expect(mp4.includes('mp4a')).toBe(true);
  });
});
