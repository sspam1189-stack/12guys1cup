import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJson } from '../scripts/lib/sleeper.mjs';

afterEach(() => vi.unstubAllGlobals());

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')));
    expect(await fetchJson('/league/1')).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('https://api.sleeper.app/v1/league/1');
  });

  it('retries on failure then succeeds', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
      .mockResolvedValueOnce(new Response('[1]'));
    vi.stubGlobal('fetch', fn);
    expect(await fetchJson('/x', { retries: 2, delayMs: 1 })).toEqual([1]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    await expect(fetchJson('/x', { retries: 1, delayMs: 1 })).rejects.toThrow('HTTP 500');
  });
});
