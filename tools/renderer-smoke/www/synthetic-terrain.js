/**
 * A synthetic terrain provider for the smoke run: quantized-mesh tiles built in the page from an
 * analytic height field around a pin, with vertex normals (oct-encoded, as Cesium's own terrain
 * carries them) and a water mask - the two things the real terrain has and the ellipsoid lacks,
 * without which Cesium never applies the ground material to the globe and draws no water.
 *
 * The world, in metres east (x) and north (y) of the pin, sea level at the ellipsoid:
 * - the sea to the west of a coastline 40 m west of the pin that wanders by 60 m over 2.5 km,
 *   shelving to 40 m deep;
 * - a beach and a coastal plain rising from the shore (the pin stands about 2 m up);
 * - a ridge 3.5 km east, 800 m high, with valleys cut into it every ~3.8 km along its length,
 *   and low hills on the plain.
 * Not a real place: a stage to see the renderer's relief, ground paint, coast and water on the
 * real globe program.
 */

const SIZE = 65;
const MAX_LEVEL = 16;

export function syntheticHeight(x, y) {
  const coast = -40 + 60 * Math.sin(y / 400);
  const d = x - coast;
  if (d <= 0) return Math.max(-40, -0.5 - 0.02 * -d - 6 * (1 - Math.exp(d / 60)));
  const plain = 1.0 + 1.6 * (1 - Math.exp(-d / 80)) + 0.004 * d;
  const valleys = 0.7 + 0.3 * Math.cos(y / 600);
  const ridge = 800 * Math.exp(-(((x - 3500) / 900) ** 2)) * valleys;
  const hills = 25 * Math.sin(x / 350) * Math.sin(y / 420) * (1 - Math.exp(-d / 400));
  return plain + ridge + Math.max(0, hills);
}

export function createSyntheticTerrain(C, pin) {
  const ellipsoid = C.Ellipsoid.WGS84;
  const tilingScheme = new C.GeographicTilingScheme({ ellipsoid });
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((pin.latitude * Math.PI) / 180);
  const toLocal = (lonDeg, latDeg) => [
    (lonDeg - pin.longitude) * mLon,
    (latDeg - pin.latitude) * mLat,
  ];
  const heightAt = (lonDeg, latDeg) => {
    const [x, y] = toLocal(lonDeg, latDeg);
    // Far from the pin the world is open sea; the stage is 60 km across.
    if (Math.abs(x) > 30_000 || Math.abs(y) > 30_000) return -40;
    return syntheticHeight(x, y);
  };
  const levelZeroError = C.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
    ellipsoid,
    SIZE,
    tilingScheme.getNumberOfXTilesAtLevel(0),
  );
  const occluder = new C.EllipsoidalOccluder(ellipsoid);
  const scratchNormal = new C.Cartesian3();
  const scratchOct = new C.Cartesian2();

  // Every tile to MAX_LEVEL: Cesium's sampleTerrainMostDetailed needs the availability to know
  // how deep to sample (without it the controller cannot read the ground, the sea level stays
  // unknown, and the coast rules that need it stay off).
  const availability = new C.TileAvailability(tilingScheme, MAX_LEVEL);
  for (let level = 0; level <= MAX_LEVEL; level++)
    availability.addAvailableTileRange(
      level,
      0,
      0,
      tilingScheme.getNumberOfXTilesAtLevel(level) - 1,
      tilingScheme.getNumberOfYTilesAtLevel(level) - 1,
    );
  const provider = {
    tilingScheme,
    errorEvent: new C.Event(),
    credit: undefined,
    hasWaterMask: true,
    hasVertexNormals: true,
    availability,
    getLevelMaximumGeometricError: (level) => levelZeroError / (1 << level),
    getTileDataAvailable: (x, y, level) => level <= MAX_LEVEL,
    loadTileDataAvailability: () => undefined,
    requestTileGeometry(x, y, level) {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const west = C.Math.toDegrees(rect.west);
      const east = C.Math.toDegrees(rect.east);
      const south = C.Math.toDegrees(rect.south);
      const north = C.Math.toDegrees(rect.north);
      const n = SIZE * SIZE;
      const heights = new Float64Array(n);
      const positions = new Array(n);
      let minH = Infinity;
      let maxH = -Infinity;
      for (let j = 0; j < SIZE; j++)
        for (let i = 0; i < SIZE; i++) {
          const lon = west + ((east - west) * i) / (SIZE - 1);
          const lat = south + ((north - south) * j) / (SIZE - 1);
          const h = heightAt(lon, lat);
          const k = j * SIZE + i;
          heights[k] = h;
          minH = Math.min(minH, h);
          maxH = Math.max(maxH, h);
          positions[k] = C.Cartesian3.fromDegrees(lon, lat, h, ellipsoid);
        }
      if (maxH - minH < 0.01) maxH = minH + 0.01;
      // u, v, h each 0..32767, in three runs (the decoded form of the format).
      const q = new Uint16Array(3 * n);
      const normals = new Uint8Array(2 * n);
      for (let j = 0; j < SIZE; j++)
        for (let i = 0; i < SIZE; i++) {
          const k = j * SIZE + i;
          q[k] = Math.round((32767 * i) / (SIZE - 1));
          q[n + k] = Math.round((32767 * j) / (SIZE - 1));
          q[2 * n + k] = Math.round((32767 * (heights[k] - minH)) / (maxH - minH));
          // The normal from the height field's own slope (central differences, 5 m apart), in
          // the fixed frame as the format has it.
          const lon = west + ((east - west) * i) / (SIZE - 1);
          const lat = south + ((north - south) * j) / (SIZE - 1);
          const dLon = 5 / mLon;
          const dLat = 5 / mLat;
          const dx = (heightAt(lon + dLon, lat) - heightAt(lon - dLon, lat)) / 10;
          const dy = (heightAt(lon, lat + dLat) - heightAt(lon, lat - dLat)) / 10;
          const enu = C.Transforms.eastNorthUpToFixedFrame(positions[k], ellipsoid);
          const e = C.Matrix4.getColumn(enu, 0, new C.Cartesian4());
          const nn = C.Matrix4.getColumn(enu, 1, new C.Cartesian4());
          const u = C.Matrix4.getColumn(enu, 2, new C.Cartesian4());
          scratchNormal.x = -dx * e.x - dy * nn.x + u.x;
          scratchNormal.y = -dx * e.y - dy * nn.y + u.y;
          scratchNormal.z = -dx * e.z - dy * nn.z + u.z;
          C.Cartesian3.normalize(scratchNormal, scratchNormal);
          C.AttributeCompression.octEncode(scratchNormal, scratchOct);
          normals[2 * k] = scratchOct.x;
          normals[2 * k + 1] = scratchOct.y;
        }
      const indices = new Uint16Array((SIZE - 1) * (SIZE - 1) * 6);
      let t = 0;
      for (let j = 0; j < SIZE - 1; j++)
        for (let i = 0; i < SIZE - 1; i++) {
          const a = j * SIZE + i;
          const b = a + 1;
          const c = a + SIZE;
          const d = c + 1;
          indices[t++] = a;
          indices[t++] = b;
          indices[t++] = c;
          indices[t++] = b;
          indices[t++] = d;
          indices[t++] = c;
        }
      const edge = (pred) => {
        const out = [];
        for (let k = 0; k < n; k++) if (pred(k % SIZE, Math.floor(k / SIZE))) out.push(k);
        return new Uint16Array(out);
      };
      // The water mask: 256 x 256, the north row first, water where the ground is under the sea.
      let wet = 0;
      const mask = new Uint8Array(256 * 256);
      for (let r = 0; r < 256; r++)
        for (let c = 0; c < 256; c++) {
          const lon = west + ((east - west) * (c + 0.5)) / 256;
          const lat = north - ((north - south) * (r + 0.5)) / 256;
          const water = heightAt(lon, lat) < 0 ? 255 : 0;
          mask[r * 256 + c] = water;
          if (water) wet++;
        }
      const waterMask =
        wet === 0 ? new Uint8Array([0]) : wet === 256 * 256 ? new Uint8Array([255]) : mask;
      const center = C.Cartesian3.fromRadians(
        (rect.west + rect.east) / 2,
        (rect.south + rect.north) / 2,
        (minH + maxH) / 2,
        ellipsoid,
      );
      const skirt = (levelZeroError / (1 << level)) * 5;
      return Promise.resolve(
        new C.QuantizedMeshTerrainData({
          center,
          minimumHeight: minH,
          maximumHeight: maxH,
          boundingSphere: C.BoundingSphere.fromPoints(positions),
          orientedBoundingBox: C.OrientedBoundingBox.fromRectangle(rect, minH, maxH, ellipsoid),
          horizonOcclusionPoint: occluder.computeHorizonCullingPoint(center, positions),
          quantizedVertices: q,
          encodedNormals: normals,
          indices,
          westIndices: edge((i) => i === 0),
          southIndices: edge((i, j) => j === 0),
          eastIndices: edge((i) => i === SIZE - 1),
          northIndices: edge((i, j) => j === SIZE - 1),
          westSkirtHeight: skirt,
          southSkirtHeight: skirt,
          eastSkirtHeight: skirt,
          northSkirtHeight: skirt,
          childTileMask: level < MAX_LEVEL ? 15 : 0,
          waterMask,
          // The data's flags, not inferred from what it carries: without them Cesium meshes the
          // tile with no normals and lights the globe by its day/night shading, not the vertex
          // lighting (and the light split) the app's terrain gets.
          requestVertexNormals: true,
          requestWaterMask: true,
        }),
      );
    },
  };
  return provider;
}
