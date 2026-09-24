import { describe, expect, it } from 'vitest';
import { selectedUtc, usePlannerStore } from '@/features/planner/store';

const kailua = {
  point: { latitude: 21.397, longitude: -157.727 },
  timeZone: 'Pacific/Honolulu',
  label: 'Kailua Beach',
  source: 'search' as const,
};

describe('planner store', () => {
  it('keeps the wall-clock selection when the location changes zones', () => {
    const s = usePlannerStore.getState();
    s.setDate('2026-05-31');
    s.setMinutes(12 * 60 + 30);
    s.setLocation(kailua);
    expect(selectedUtc(usePlannerStore.getState())?.toISOString()).toBe('2026-05-31T22:30:00.000Z');
    s.setLocation({ ...kailua, timeZone: 'Europe/London', label: 'London' });
    expect(selectedUtc(usePlannerStore.getState())?.toISOString()).toBe('2026-05-31T11:30:00.000Z'); // BST
    expect(usePlannerStore.getState().minutes).toBe(750);
  });
  it('clamps minutes, rejects bad dates, wraps heading and clamps pitch', () => {
    const s = usePlannerStore.getState();
    s.setMinutes(5000);
    expect(usePlannerStore.getState().minutes).toBe(1439);
    s.setDate('2026-02-30');
    expect(usePlannerStore.getState().date).toBe('2026-05-31');
    s.setHeading(-30);
    expect(usePlannerStore.getState().camera.headingDeg).toBe(330);
    s.setPitch(120);
    expect(usePlannerStore.getState().camera.pitchDeg).toBe(89);
    s.setFocalLength(50);
    expect(usePlannerStore.getState().camera.fovDeg).toBeCloseTo(39.6, 1);
  });
  it('restores a saved viewpoint into date/time/camera/scenario', () => {
    usePlannerStore.getState().restore({
      location: kailua,
      utc: new Date('2026-05-31T22:30:00Z'),
      camera: { ...usePlannerStore.getState().camera, headingDeg: 270, mode: 'viewpoint' },
      scenario: 'overcast',
    });
    const st = usePlannerStore.getState();
    expect(st.date).toBe('2026-05-31');
    expect(st.minutes).toBe(750);
    expect(st.camera.mode).toBe('viewpoint');
    expect(st.scenario).toBe('overcast');
    expect(st.forceScenario).toBe(true);
  });
  it('selectedUtc is null without a location', () => {
    usePlannerStore.getState().clearLocation();
    expect(selectedUtc(usePlannerStore.getState())).toBeNull();
  });
});
