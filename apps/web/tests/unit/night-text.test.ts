import { describe, expect, it } from 'vitest';
import { eclipsesAhead, fullMoonsAhead, milkyWayCore } from '@lightmap/astronomy';
import {
  describeDisc,
  describeMilkyWay,
  describeMoonSize,
  describeEclipse,
  describeNextPhases,
  formatFullMoon,
  formatSeconds,
} from '../../features/planner/night-text.ts';

describe('night read-outs', () => {
  it('names where the core stands and the reason, or that it is below the horizon', () => {
    const dark = describeMilkyWay(milkyWayCore(new Date('2026-06-15T12:00:00Z'), 21.397, -157.727));
    expect(dark).toMatch(/^3\d° up S(SW|W) — Astronomical night, Moon down$/);
    const winter = describeMilkyWay(
      milkyWayCore(new Date('2026-12-15T10:00:00Z'), 21.397, -157.727),
    );
    expect(winter).toBe('below the horizon — Galactic core below the horizon');
    // Hand-built: a core just under the horizon by day.
    expect(
      describeMilkyWay({
        azimuthDeg: 100,
        elevationDeg: -0.2,
        sunElevationDeg: 30,
        moonUp: false,
        moonIlluminatedFraction: 0,
        verdict: 'daylight',
        reason: 'Daylight or civil twilight: no stars',
      }),
    ).toBe('below the horizon — Daylight or civil twilight: no stars');
  });

  it('lists the next four principal phases as dates in the given zone', () => {
    // From the start of 31 May 2026 HST: the full Moon (31 May 08:45 UTC = 30 May 22:45 HST) has
    // passed, so the list starts with the last quarter.
    const line = describeNextPhases(new Date('2026-05-31T10:00:00Z'), 'Pacific/Honolulu');
    expect(line).toMatch(
      /^Last quarter [78] Jun · New 14 Jun · First quarter 21 Jun · Full 29 Jun$/,
    );
    // The same instants in a zone a day ahead move the day numbers where midnight is crossed.
    const tokyo = describeNextPhases(new Date('2026-05-31T10:00:00Z'), 'Asia/Tokyo');
    expect(tokyo.split(' · ')).toHaveLength(4);
    expect(tokyo).toMatch(/^Last quarter 8 Jun · New 15 Jun/);
  });
});

describe('apparent sizes', () => {
  it('the disc row: degrees alone on the map, with its share of the frame width at a viewpoint', () => {
    expect(describeDisc(0.5329, null)).toBe('0.53°');
    expect(describeDisc(0.5329, 0)).toBe('0.53°');
    // 24 mm-equivalent (73.7°) and 400 mm (5.15°).
    expect(describeDisc(0.52, 73.74)).toBe('0.52° · 0.6 % of frame');
    expect(describeDisc(0.52, 5.153)).toBe('0.52° · 10 % of frame');
    // A frame as wide as the disc.
    expect(describeDisc(0.52, 0.52)).toBe('0.52° · 100 % of frame');
  });

  it('the Moon against its mean: wider, narrower or average, whole percent', () => {
    expect(describeMoonSize(0.078)).toBe('8 % wider than average');
    expect(describeMoonSize(-0.055)).toBe('6 % narrower than average');
    expect(describeMoonSize(0.004)).toBe('average size');
    expect(describeMoonSize(0)).toBe('average size');
  });

  it("names a full Moon by its date in the zone and its size: the year's closest and farthest", () => {
    const r = fullMoonsAhead(new Date('2025-01-01T00:00:00Z'), 12);
    expect(formatFullMoon(r.moons[r.closest]!, 'Pacific/Honolulu')).toBe('5 Nov (+8 %)');
    expect(formatFullMoon(r.moons[r.farthest]!, 'Pacific/Honolulu')).toBe('12 Apr (−5 %)');
    // 13 Apr 00:23 UTC is still 12 April in Hawaii; a zone ahead of UTC keeps the 13th.
    expect(formatFullMoon(r.moons[r.farthest]!, 'Asia/Tokyo')).toBe('13 Apr (−5 %)');
    expect(
      formatFullMoon(
        { at: new Date('2026-04-20T22:27:21Z'), distanceKm: 384_399, sizeVsMean: 0 },
        'UTC',
      ),
    ).toBe('20 Apr (0 %)');
  });

  it('describes an eclipse from here: the March 2026 lunar eclipse up throughout in Hawaii, down in Rome', () => {
    const e = eclipsesAhead(
      { latitude: 21.3, longitude: -157.86 },
      new Date('2026-02-20T00:00:00Z'),
      1,
    )[0]!;
    const line = describeEclipse(e, 'Pacific/Honolulu');
    expect(line.title).toBe('Total lunar eclipse');
    expect(line.date).toBe('3 Mar');
    expect(line.detail).toMatch(
      /^greatest 01:3\d, in the umbra 23:5\d–03:1\d, total 01:0\d–02:0\d — the Moon up throughout from here, \d+° [A-Z]+ at greatest$/,
    );
    expect(line.at).toBe(e.greatest);
    const rome = eclipsesAhead(
      { latitude: 41.9, longitude: 12.5 },
      new Date('2026-02-20T00:00:00Z'),
      1,
    )[0]!;
    expect(describeEclipse(rome, 'Europe/Rome').detail).toMatch(
      /— the Moon is below the horizon here$/,
    );
  });

  it('a solar eclipse here: total in Burgos with its seconds, partial in London with its coverage', () => {
    const burgos = eclipsesAhead(
      { latitude: 42.34, longitude: -3.7 },
      new Date('2026-08-01T00:00:00Z'),
      1,
    )[0]!;
    const b = describeEclipse(burgos, 'Europe/Madrid');
    expect(b.title).toBe('Total solar eclipse here');
    expect(b.date).toBe('12 Aug');
    expect(b.detail).toMatch(
      /^totality 20:2\d:\d\d–20:3\d:\d\d \(1 min \d+ s\), 19:3\d–21:2\d, Sun 8° up W(NW)?; the Sun sets before it ends$/,
    );
    const london = eclipsesAhead(
      { latitude: 51.5, longitude: -0.12 },
      new Date('2026-08-01T00:00:00Z'),
      1,
    )[0]!;
    const l = describeEclipse(london, 'Europe/London');
    expect(l.title).toBe('Partial solar eclipse here');
    expect(l.detail).toMatch(
      /^greatest 19:13, 92 % of the Sun’s width covered \(91 % of the disc\), 18:17–20:06, Sun 10° up W(NW)?$/,
    );
  });

  it('formats seconds as minutes and seconds', () => {
    expect(formatSeconds(97)).toBe('1 min 37 s');
    expect(formatSeconds(385.4)).toBe('6 min 25 s');
    expect(formatSeconds(48)).toBe('48 s');
  });
});
