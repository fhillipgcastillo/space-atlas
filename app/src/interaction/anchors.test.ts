import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { projectToScreen } from './anchors.js';

const camera = (): PerspectiveCamera => {
  const c = new PerspectiveCamera(60, 16 / 9, 0.001, 1e7);
  c.position.set(0, 0, 100);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld(true);
  return c;
};

describe('projectToScreen', () => {
  it('puts a point straight ahead at the centre of the screen', () => {
    const result = projectToScreen(new Vector3(0, 0, 0), camera(), 1920, 1080);
    expect(result.x).toBeCloseTo(960, 0);
    expect(result.y).toBeCloseTo(540, 0);
    expect(result.visible).toBe(true);
  });

  it('marks a point behind the camera as not visible', () => {
    const result = projectToScreen(new Vector3(0, 0, 500), camera(), 1920, 1080);
    expect(result.visible).toBe(false);
  });

  it('puts a point above the axis higher on the screen', () => {
    const result = projectToScreen(new Vector3(0, 10, 0), camera(), 1920, 1080);
    expect(result.y).toBeLessThan(540);
  });

  it('does not mutate the world vector it projects', () => {
    const world = new Vector3(3, 4, 5);
    projectToScreen(world, camera(), 1920, 1080);
    expect([world.x, world.y, world.z]).toEqual([3, 4, 5]);
  });
});
