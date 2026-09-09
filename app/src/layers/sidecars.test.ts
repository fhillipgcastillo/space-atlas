import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadIdentifiers, loadNames } from './sidecars.js';

const respond = (body: BodyInit, init: ResponseInit) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, init)));

afterEach(() => vi.unstubAllGlobals());

describe('loadNames', () => {
  it('reads a real sidecar', async () => {
    respond(JSON.stringify({ '0': 'Sun', '4': 'Jupiter' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const names = await loadNames('/data/solar-system');
    expect(names.get(0)).toBe('Sun');
    expect(names.get(4)).toBe('Jupiter');
  });

  it('returns empty when a dev server answers a missing file with index.html', async () => {
    // Vite serves the SPA fallback with a 200, so response.ok is not enough;
    // parsing that as JSON throws an uncaught promise rejection.
    respond('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    await expect(loadNames('/data/stellar-neighbourhood')).resolves.toEqual(new Map());
  });

  it('returns empty rather than throwing on malformed JSON', async () => {
    respond('{ not json', { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(loadNames('/data/x')).resolves.toEqual(new Map());
  });

  it('returns empty on a genuine 404', async () => {
    respond('', { status: 404, headers: { 'content-type': 'text/plain' } });
    await expect(loadNames('/data/x')).resolves.toEqual(new Map());
  });

  it('returns empty when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(loadNames('/data/x')).resolves.toEqual(new Map());
  });
});

describe('loadIdentifiers', () => {
  it('reads a whole number of 64-bit identifiers', async () => {
    const ids = new BigUint64Array([1n, 4295806720000000001n]);
    respond(ids.buffer as ArrayBuffer, { status: 200 });
    const loaded = await loadIdentifiers('/data/x');
    expect(loaded?.[1]).toBe(4295806720000000001n);
  });

  it('rejects a truncated table rather than misaligning every identifier', async () => {
    respond(new Uint8Array(12).buffer as ArrayBuffer, { status: 200 });
    await expect(loadIdentifiers('/data/x')).resolves.toBeUndefined();
  });

  it('returns undefined when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(loadIdentifiers('/data/x')).resolves.toBeUndefined();
  });
});
