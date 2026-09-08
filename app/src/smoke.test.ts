import { describe, expect, it } from 'vitest';
import { boot } from './main.js';

describe('boot', () => {
  it('identifies the app', () => {
    expect(boot()).toBe('universe-map');
  });
});
