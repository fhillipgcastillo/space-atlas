import { describe, expect, it } from 'vitest';
import {
  FLAG_MODELED,
  FLAG_NO_RADIAL_VELOCITY,
  TYPE_BLACK_HOLE,
  TYPE_STAR,
  describeType,
  hasRadialVelocity,
} from './typeFlags.js';

describe('describeType', () => {
  it('names the object class', () => {
    expect(describeType(TYPE_STAR)).toBe('Star');
    expect(describeType(TYPE_BLACK_HOLE)).toBe('Black hole');
  });

  it('marks a modeled object so it cannot be read as measured', () => {
    expect(describeType(TYPE_STAR | FLAG_MODELED)).toBe('Star (modeled)');
  });

  it('is unaffected by the radial velocity flag', () => {
    expect(describeType(TYPE_STAR | FLAG_NO_RADIAL_VELOCITY)).toBe('Star');
  });

  it('falls back rather than inventing a class', () => {
    expect(describeType(0)).toBe('Unknown');
  });
});

describe('hasRadialVelocity', () => {
  it('distinguishes a measured velocity from an unknown one', () => {
    expect(hasRadialVelocity(TYPE_STAR)).toBe(true);
    expect(hasRadialVelocity(TYPE_STAR | FLAG_NO_RADIAL_VELOCITY)).toBe(false);
  });
});
