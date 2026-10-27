// What keeps a public Helpdock safe to leave online: per-client rate limits, the admin token for writes, the client
// address behind a proxy, and the page's security headers. No I/O, so tests/guard.test.ts covers all of it.
import { createHash, timingSafeEqual } from 'node:crypto';

/** A fixed-window counter per key: `limit` hits per `windowMs`. Old windows are dropped as keys come back. */
export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit; returns the seconds to wait when the key is over its limit, or 0 when the hit is allowed. */
  hit(key: string): number {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || t - entry.start >= this.windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      if (this.hits.size > 50_000) this.sweep(t);
      return 0;
    }
    entry.count++;
    return entry.count > this.limit ? Math.ceil((entry.start + this.windowMs - t) / 1000) : 0;
  }

  private sweep(t: number) {
    for (const [key, entry] of this.hits) if (t - entry.start >= this.windowMs) this.hits.delete(key);
  }
}

/**
 * Which proxy header names the client: `none` (direct; the socket address), `last-forwarded` (one trusted proxy that
 * appends to X-Forwarded-For, such as Render: the last entry is the address it saw, while earlier ones are whatever the
 * client sent), or `cloudflare` (CF-Connecting-IP, only safe when the origin accepts traffic from Cloudflare alone).
 */
export type ProxyMode = 'none' | 'last-forwarded' | 'cloudflare';

export function parseProxyMode(value: string | undefined): ProxyMode {
  return value === 'last-forwarded' || value === 'cloudflare' ? value : 'none';
}

/** The client address for rate limiting. */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress: string | undefined,
  mode: ProxyMode,
): string {
  if (mode === 'cloudflare') {
    const cf = headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
  }
  if (mode === 'last-forwarded') {
    const xff = headers['x-forwarded-for'];
    const entries = (Array.isArray(xff) ? xff.join(',') : (xff ?? '')).split(',').map((e) => e.trim()).filter(Boolean);
    if (entries.length > 0) return entries[entries.length - 1];
  }
  return socketAddress ?? 'unknown';
}

/** Whether `authorization` is `Bearer <token>`. Compares digests, so the check takes the same time for any guess. */
export function isAdmin(authorization: string | undefined, token: string | undefined): boolean {
  if (!token) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!match) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(match[1].trim()), digest(token));
}

/** The sha256 source of an inline script, for a Content-Security-Policy that allows exactly that script. */
export function scriptHash(html: string): string {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  return `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
}

export function securityHeaders(html: string): Record<string, string> {
  return {
    'content-security-policy': [
      "default-src 'none'",
      `script-src ${scriptHash(html)}`,
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
}
