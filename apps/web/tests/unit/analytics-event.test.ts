import { describe, expect, it } from 'vitest';
import { ANALYTICS_PROPS, parseAnalyticsBeacon } from '@/lib/analytics-event';

describe('analytics beacon (plan §31, PRIVACY §4)', () => {
  it('accepts a known event with its own, correctly typed properties', () => {
    expect(
      parseAnalyticsBeacon({
        event: 'location_selected',
        props: { source: 'search', latBucket: 21, lngBucket: -158 },
      }),
    ).toEqual({
      event: 'location_selected',
      props: { source: 'search', latBucket: 21, lngBucket: -158 },
    });
    expect(parseAnalyticsBeacon({ event: 'project_created' })).toEqual({
      event: 'project_created',
      props: {},
    });
    expect(
      parseAnalyticsBeacon({ event: 'weather_scenario_changed', props: { scenario: 'overcast' } })
        .props,
    ).toEqual({ scenario: 'overcast' });
    expect(
      parseAnalyticsBeacon({ event: 'upgrade_started', props: { interval: 'yearly' } }).props,
    ).toEqual({ interval: 'yearly' });
  });
  it('re-rounds coordinate buckets and refuses out-of-range or mistyped values', () => {
    const r = parseAnalyticsBeacon({
      event: 'location_selected',
      props: { source: 'map-click', latBucket: 21.397, lngBucket: -157.727 },
    });
    expect(r.props).toEqual({ source: 'map-click', latBucket: 21, lngBucket: -158 });
    expect(
      parseAnalyticsBeacon({
        event: 'location_selected',
        props: { source: 'elsewhere', latBucket: 400, lngBucket: '12' },
      }).props,
    ).toEqual({});
    expect(
      parseAnalyticsBeacon({ event: 'weather_scenario_changed', props: { scenario: 'hurricane' } })
        .props,
    ).toEqual({});
    expect(
      parseAnalyticsBeacon({ event: 'viewpoint_saved', props: { variant: 'true' } }).props,
    ).toEqual({});
  });
  it("drops everything that is not on the event's list — precise coordinates, free text, nested values", () => {
    const r = parseAnalyticsBeacon({
      event: 'viewpoint_saved',
      props: {
        lat: 21.397,
        longitude: -157.727,
        label: 'Kailua Beach',
        query: 'secret place',
        email: 'x@y.z',
        notes: 'free text',
        place: 'somewhere specific',
        nested: { a: 1 },
        list: [1, 2],
        variant: true,
      },
    });
    expect(r.props).toEqual({ variant: true });
    // A property another event owns is not accepted on this one.
    expect(
      parseAnalyticsBeacon({ event: 'project_created', props: { latBucket: 21 } }).props,
    ).toEqual({});
  });
  it('rejects unknown events and malformed bodies', () => {
    expect(() => parseAnalyticsBeacon({ event: 'page_view' })).toThrow(/known product event/);
    expect(() => parseAnalyticsBeacon({ event: 'project_created', props: [] })).toThrow(/object/);
    expect(() => parseAnalyticsBeacon({ event: 'project_created', props: 'x' })).toThrow(/object/);
    expect(() => parseAnalyticsBeacon(null)).toThrow(/object/);
    expect(() => parseAnalyticsBeacon('project_created')).toThrow(/object/);
  });
  it('every event has a rule table (the privacy page describes them)', () => {
    expect(Object.keys(ANALYTICS_PROPS).sort()).toEqual(
      [
        'location_selected',
        'timeline_scrubbed',
        'weather_scenario_changed',
        'project_created',
        'viewpoint_saved',
        'preview_expanded',
        'upgrade_started',
        'subscription_started',
      ].sort(),
    );
  });
});
