import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clientIp, isAdmin, parseProxyMode, RateLimiter, scriptHash, securityHeaders } from '../src/guard';

describe('RateLimiter', () => {
  it('allows the limit, then says how long to wait, then resets with the window', () => {
    let t = 0;
    const limiter = new RateLimiter(2, 60_000, () => t);
    expect(limiter.hit('a')).toBe(0);
    expect(limiter.hit('a')).toBe(0);
    t = 15_000;
    expect(limiter.hit('a')).toBe(45);
    expect(limiter.hit('b')).toBe(0);
    t = 60_000;
    expect(limiter.hit('a')).toBe(0);
  });
});

describe('clientIp', () => {
  const headers = { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6, 198.51.100.1' };

  it('reads the proxy header only in the mode that trusts it', () => {
    expect(clientIp(headers, '10.0.0.2', 'cloudflare')).toBe('203.0.113.7');
    // The first entry is client-supplied; the last is the one the trusted proxy appended.
    expect(clientIp(headers, '10.0.0.2', 'last-forwarded')).toBe('198.51.100.1');
    expect(clientIp(headers, '10.0.0.2', 'none')).toBe('10.0.0.2');
    expect(clientIp({}, '10.0.0.2', 'last-forwarded')).toBe('10.0.0.2');
  });

  it('parseProxyMode falls back to none', () => {
    expect(parseProxyMode('last-forwarded')).toBe('last-forwarded');
    expect(parseProxyMode('1')).toBe('none');
    expect(parseProxyMode(undefined)).toBe('none');
  });
});

describe('isAdmin', () => {
  it('accepts only the exact bearer token, and nothing when no token is set', () => {
    expect(isAdmin('Bearer s3cret', 's3cret')).toBe(true);
    expect(isAdmin('bearer  s3cret ', 's3cret')).toBe(true);
    expect(isAdmin('Bearer s3cre', 's3cret')).toBe(false);
    expect(isAdmin('s3cret', 's3cret')).toBe(false);
    expect(isAdmin(undefined, 's3cret')).toBe(false);
    expect(isAdmin('Bearer ', undefined)).toBe(false);
  });
});

describe('securityHeaders', () => {
  it('allows exactly the page script', () => {
    const html = '<p>x</p><script>alert(1)</script>';
    const expected = createHash('sha256').update('alert(1)').digest('base64');
    expect(scriptHash(html)).toBe(`'sha256-${expected}'`);
    const csp = securityHeaders(html)['content-security-policy'];
    expect(csp).toContain(`script-src 'sha256-${expected}'`);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
