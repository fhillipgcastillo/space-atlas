/** Optional per-layer sidecars. A missing one means "not available", never an error. */

const isJson = (response: Response): boolean =>
  response.headers.get('content-type')?.includes('json') === true;

export async function loadNames(url: string): Promise<Map<number, string>> {
  const response = await fetch(`${url}/names.json`).catch(() => undefined);
  if (!response?.ok) return new Map();
  // A dev server answers an absent file with index.html and a 200, so ok alone
  // is not enough - parsing that as JSON throws.
  if (!isJson(response)) return new Map();
  try {
    const raw = (await response.json()) as Record<string, string>;
    return new Map(Object.entries(raw).map(([key, value]) => [Number(key), value]));
  } catch (error: unknown) {
    console.warn(`names.json for ${url} is not valid JSON`, error);
    return new Map();
  }
}

export async function loadIdentifiers(url: string): Promise<BigUint64Array | undefined> {
  const response = await fetch(`${url}/ids.bin`).catch(() => undefined);
  if (!response?.ok) return undefined;
  const buffer = await response.arrayBuffer();
  // Same trap, plus a truncated file would misalign every identifier.
  if (buffer.byteLength === 0 || buffer.byteLength % 8 !== 0) {
    console.warn(`ids.bin for ${url} is not a whole number of 64-bit identifiers`);
    return undefined;
  }
  return new BigUint64Array(buffer);
}
