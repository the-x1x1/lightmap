/**
 * Astronomical azimuth/elevation → renderer world coordinates (plan §10: "The mapping should
 * have unit tests").
 *
 * Cesium's world frame is Earth-Centred Earth-Fixed (ECEF, WGS84): +X through the Greenwich
 * meridian at the equator, +Z through the north pole, +Y completing the right-handed set. A
 * direction defined in the local East-North-Up frame at (lat, lon) is rotated into ECEF with the
 * standard ENU→ECEF matrix. `DirectionalLight.direction` is the direction the light TRAVELS, i.e.
 * from the Sun towards the ground, which is the negation of the "towards the Sun" vector.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** Unit vector pointing TOWARDS the Sun in the local East-North-Up frame. */
export function enuTowardSun(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return { x: Math.cos(el) * Math.sin(az), y: Math.cos(el) * Math.cos(az), z: Math.sin(el) };
}

/** Rotate an ENU vector at (lat, lon) into ECEF. */
export function enuToEcef(v: Vec3, latitudeDeg: number, longitudeDeg: number): Vec3 {
  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  // Columns are the ENU axes expressed in ECEF.
  const east = { x: -sLon, y: cLon, z: 0 };
  const north = { x: -sLat * cLon, y: -sLat * sLon, z: cLat };
  const up = { x: cLat * cLon, y: cLat * sLon, z: sLat };
  return {
    x: v.x * east.x + v.y * north.x + v.z * up.x,
    y: v.x * east.y + v.y * north.y + v.z * up.y,
    z: v.x * east.z + v.y * north.z + v.z * up.z,
  };
}

/** Inverse of `enuToEcef`. */
export function ecefToEnu(v: Vec3, latitudeDeg: number, longitudeDeg: number): Vec3 {
  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const sLat = Math.sin(lat);
  const cLat = Math.cos(lat);
  const sLon = Math.sin(lon);
  const cLon = Math.cos(lon);
  return {
    x: -sLon * v.x + cLon * v.y,
    y: -sLat * cLon * v.x - sLat * sLon * v.y + cLat * v.z,
    z: cLat * cLon * v.x + cLat * sLon * v.y + sLat * v.z,
  };
}

/** The direction sunlight travels (Sun → ground) in ECEF, ready for Cesium's DirectionalLight. */
export function sunLightDirectionEcef(azimuthDeg: number, elevationDeg: number, latitudeDeg: number, longitudeDeg: number): Vec3 {
  const toward = enuToEcef(enuTowardSun(azimuthDeg, elevationDeg), latitudeDeg, longitudeDeg);
  return { x: -toward.x, y: -toward.y, z: -toward.z };
}

/** Recover azimuth/elevation from an ECEF "toward the Sun" vector — used by the debug panel to cross-check Cesium's own sun. */
export function azElFromEcefToward(v: Vec3, latitudeDeg: number, longitudeDeg: number): { azimuthDeg: number; elevationDeg: number } {
  const e = ecefToEnu(v, latitudeDeg, longitudeDeg);
  const len = Math.hypot(e.x, e.y, e.z) || 1;
  const az = (Math.atan2(e.x / len, e.y / len) / DEG + 360) % 360;
  const el = Math.asin(Math.max(-1, Math.min(1, e.z / len))) / DEG;
  return { azimuthDeg: az, elevationDeg: el };
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Angle between two vectors in degrees. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const d = Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))));
  return Math.acos(d) / DEG;
}

/**
 * Shadow direction on flat ground: the azimuth shadows fall toward (opposite the Sun) and the
 * length of a shadow cast by a 1 m object. Both are used by the Quality-0 overlay.
 */
export function shadowOnGround(azimuthDeg: number, elevationDeg: number): { azimuthDeg: number; lengthPerMetre: number | null } {
  const fall = (azimuthDeg + 180) % 360;
  if (elevationDeg <= 0.1) return { azimuthDeg: fall, lengthPerMetre: null };
  return { azimuthDeg: fall, lengthPerMetre: 1 / Math.tan(elevationDeg * DEG) };
}
