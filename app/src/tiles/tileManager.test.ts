import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, maxNodesForBudget } from './tileManager.js';

describe('maxNodesForBudget', () => {
  it('never lets a full selection exceed the byte budget', () => {
    const budget = 512 * 1024 * 1024;
    const nodes = maxNodesForBudget(budget, 41);
    expect(nodes * 65536 * 41).toBeLessThanOrEqual(budget);
  });

  it('shrinks as the per-point cost grows', () => {
    expect(maxNodesForBudget(512 * 1024 * 1024, 82)).toBeLessThan(
      maxNodesForBudget(512 * 1024 * 1024, 41),
    );
  });

  it('always allows at least one node', () => {
    expect(maxNodesForBudget(1, 41)).toBe(1);
  });

  it('keeps the shipped defaults self-consistent', () => {
    expect(DEFAULT_OPTIONS.maxVisibleNodes * 65536 * 41).toBeLessThanOrEqual(
      DEFAULT_OPTIONS.gpuByteBudget,
    );
  });
});
