import { describe, expect, it } from 'vitest';
import {
  restoreInputFor,
  viewpointIdFromSearch,
  viewpointUrl,
} from '../../features/projects/open-viewpoint.ts';
import type { ViewpointDto } from '../../lib/api-types.ts';

const v: ViewpointDto = {
  id: 'abc-123',
  projectId: 'p1',
  label: 'Beach, noon',
  latitude: 21.397,
  longitude: -157.727,
  elevationM: null,
  timezone: 'Pacific/Honolulu',
  headingDeg: 270,
  pitchDeg: 5,
  fieldOfViewDeg: 60,
  focalLengthEquivalentMm: 24,
  selectedDatetimeUtc: '2026-05-31T22:30:00Z',
  weatherMode: 'SCENARIO',
  weatherScenario: 'overcast',
  previewSourceType: 'ESTIMATED_PREVIEW',
  parentViewpointId: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('reopening a viewpoint', () => {
  it('restores the place in its own zone, the instant, the camera from the lens, the scenario', () => {
    const r = restoreInputFor(v);
    expect(r.location).toEqual({
      point: { latitude: 21.397, longitude: -157.727 },
      timeZone: 'Pacific/Honolulu',
      label: 'Beach, noon',
      source: 'saved',
    });
    expect(r.utc.toISOString()).toBe('2026-05-31T22:30:00.000Z');
    expect(r.camera.mode).toBe('viewpoint');
    expect(r.camera.headingDeg).toBe(270);
    expect(r.camera.focalLengthMm).toBe(24);
    // A 24 mm full-frame lens is ~73.7° across; the stored field of view is ignored in its favour.
    expect(r.camera.fovDeg).toBeCloseTo(73.7, 0);
    expect(r.scenario).toBe('overcast');
    // Without a lens the stored field of view stands; an unknown scenario id is dropped; the
    // elevation is carried when known.
    const bare = restoreInputFor({
      ...v,
      focalLengthEquivalentMm: null,
      weatherScenario: 'hurricane',
      elevationM: 12,
    });
    expect(bare.camera.fovDeg).toBe(60);
    expect(bare.camera.focalLengthMm).toBeNull();
    expect(bare.scenario).toBeNull();
    expect(bare.location.point.elevationM).toBe(12);
  });

  it('reads and writes the viewpoint link', () => {
    expect(viewpointIdFromSearch('?viewpoint=abc-123&source=pwa')).toBe('abc-123');
    expect(viewpointIdFromSearch('?source=pwa')).toBeNull();
    expect(viewpointIdFromSearch('?viewpoint=../etc')).toBeNull();
    expect(viewpointIdFromSearch('')).toBeNull();
    expect(viewpointUrl('https://app.example/', 'abc-123')).toBe(
      'https://app.example/?viewpoint=abc-123',
    );
  });
});
