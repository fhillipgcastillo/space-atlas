import { describe, expect, it } from 'vitest';
import {
  CLASS_GALAXY,
  CLASS_PLANET,
  CLASS_STAR,
  FLAG_MODELED,
  FLAG_NOMINAL_MAGNITUDE,
  FLAG_NO_RADIAL_VELOCITY,
  describeType,
  hasMeasuredMagnitude,
  hasRadialVelocity,
  objectClass,
} from './typeFlags.js';

describe('objectClass', () => {
  it('reads the class through any combination of flags', () => {
    const allFlags = FLAG_MODELED | FLAG_NO_RADIAL_VELOCITY | FLAG_NOMINAL_MAGNITUDE;
    expect(objectClass(CLASS_GALAXY | allFlags)).toBe(CLASS_GALAXY);
    expect(objectClass(CLASS_PLANET | allFlags)).toBe(CLASS_PLANET);
  });
});

describe('describeType', () => {
  it('names each class', () => {
    expect(describeType(CLASS_STAR)).toBe('Star');
    expect(describeType(CLASS_GALAXY)).toBe('Galaxy');
    expect(describeType(CLASS_PLANET)).toBe('Planet');
  });

  it('marks a modeled object so it cannot be read as measured', () => {
    expect(describeType(CLASS_STAR | FLAG_MODELED)).toBe('Star (modeled)');
  });

  it('is unaffected by the other flags', () => {
    expect(describeType(CLASS_GALAXY | FLAG_NO_RADIAL_VELOCITY | FLAG_NOMINAL_MAGNITUDE)).toBe(
      'Galaxy',
    );
  });
});

describe('flag predicates', () => {
  it('distinguishes a measured radial velocity from an unknown one', () => {
    expect(hasRadialVelocity(CLASS_STAR)).toBe(true);
    expect(hasRadialVelocity(CLASS_STAR | FLAG_NO_RADIAL_VELOCITY)).toBe(false);
  });

  it('distinguishes a measured magnitude from a nominal one', () => {
    expect(hasMeasuredMagnitude(CLASS_GALAXY)).toBe(true);
    expect(hasMeasuredMagnitude(CLASS_GALAXY | FLAG_NOMINAL_MAGNITUDE)).toBe(false);
  });
});
