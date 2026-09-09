import {
  BufferGeometry,
  Float16BufferAttribute,
  Points,
  type RawShaderMaterial,
  Sphere,
  Uint8BufferAttribute,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import type { DecodedTile } from '../tiles/format.js';

export function createTileMesh(tile: DecodedTile, material: RawShaderMaterial): Points {
  const geometry = new BufferGeometry();

  // normalized = true so the shader sees the 0..1 bounding-box fraction the format defines.
  geometry.setAttribute('position', new Uint16BufferAttribute(tile.positionQuantized, 3, true));
  // tile.velocity is raw float16 bits in km/s; Float16BufferAttribute uploads
  // them as HALF_FLOAT verbatim, so nothing is decoded on the CPU.
  geometry.setAttribute('aVelocity', new Float16BufferAttribute(tile.velocity, 3));
  geometry.setAttribute('aColourIndex', new Uint16BufferAttribute(tile.colorIndex, 1, true));
  geometry.setAttribute('aAbsMag', new Float16BufferAttribute(tile.absMag, 1));
  geometry.setAttribute('aTypeFlags', new Uint8BufferAttribute(tile.typeFlags, 1, true));

  const min = new Vector3(tile.bboxMin[0]!, tile.bboxMin[1]!, tile.bboxMin[2]!);
  const max = new Vector3(tile.bboxMax[0]!, tile.bboxMax[1]!, tile.bboxMax[2]!);
  // Positions are normalized, so Three cannot infer this; set it from the real box.
  geometry.boundingSphere = new Sphere(
    min.clone().add(max).multiplyScalar(0.5),
    min.distanceTo(max) * 0.5,
  );

  const tileMaterial = material.clone();
  tileMaterial.uniforms['uBboxMin']!.value = min;
  tileMaterial.uniforms['uBboxExtent']!.value = max.clone().sub(min);
  // cloneUniforms copies anything with isTexture, and material.dispose() does
  // not dispose textures, so every clone would leak a ramp on eviction.
  tileMaterial.uniforms['uColourRamp']!.value = material.uniforms['uColourRamp']!.value;

  const points = new Points(geometry, tileMaterial);
  points.frustumCulled = false;
  points.name = 'tile';
  return points;
}
