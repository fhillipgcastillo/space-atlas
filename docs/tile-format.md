# Tile format v1

Frozen contract between `pipeline/` and `app/`. Little-endian throughout.

## Header — 64 bytes

| Offset | Size | Type | Field |
|---|---|---|---|
| 0 | 4 | bytes | magic, `"UMT1"` |
| 4 | 4 | uint32 | format version, `1` |
| 8 | 4 | uint32 | point count `N` |
| 12 | 4 | uint32 | attribute mask, `0x3F` in v1 |
| 16 | 24 | 3 x float64 | bounding box minimum, layer units |
| 40 | 24 | 3 x float64 | bounding box maximum, layer units |

## Attribute blocks

Structure-of-arrays, in this fixed order, each padded to a 4-byte boundary.

| Order | Attribute | Type | Bytes |
|---|---|---|---|
| 1 | position | uint16 x 3 | 6N |
| 2 | velocity | float16 x 3 | 6N |
| 3 | colorIndex | uint16 | 2N |
| 4 | absMag | float16 | 2N |
| 5 | typeFlags | uint8 | N |
| 6 | localId | uint32 | 4N |

The first block starts at offset 64. Each block starts at the first 4-byte
boundary at or after the end of the previous block; padding bytes are zero.
The file ends on a 4-byte boundary, since the final block is padded too.

## Position quantization

Positions are stored as unsigned 16-bit fractions of the tile's own bounding box:

```
q     = round((pos - bboxMin) / (bboxMax - bboxMin) * 65535)
pos   = bboxMin + (q / 65535) * (bboxMax - bboxMin)
```

Precision therefore scales with tile size automatically. A degenerate axis
(`bboxMax == bboxMin`) encodes as 0 and decodes to `bboxMin`.

The encoder clamps the fraction to `[0, 1]`, so a point outside the tile's own
bounding box is pinned to the nearest face rather than wrapping. `round` is
round-half-to-even (numpy `rint`), which differs from JavaScript's `Math.round`
on exact half-steps; only the pipeline encodes, so readers are unaffected.

Maximum quantization error on an axis is half a step, `(bboxMax - bboxMin) / 131070`.

## typeFlags

Bit 0 set means the object is **modeled**, not measured. Bits 1-7 are the object
class enumeration. Phase 1 writes class 1 (star) with bit 0 clear.

## localId

An index into the layer's identifier table, not a catalog identifier. Catalog
identifiers are 64-bit and live in the hover sidecar. `localId` stays CPU-side;
it is never uploaded to the GPU.
