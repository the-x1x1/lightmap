/**
 * The exposure estimate for a saved viewpoint from what it carries: its instant and place for
 * the Sun and Moon, the saved scenario's direct share or the cloud it was saved under (a clear
 * sky without either). The same model as the planner's row; pure, unit-tested.
 */
import { moonPosition, sunPosition } from '@lightmap/astronomy';
import { estimateExposure, type ExposureEstimate } from '@lightmap/scene';
import { isScenarioId, parametersForForecast, scenarioById } from '@lightmap/weather';
import type { ViewpointDto } from '@/lib/api-types';

export function viewpointExposure(
  v: Pick<
    ViewpointDto,
    'latitude' | 'longitude' | 'selectedDatetimeUtc' | 'weatherMode' | 'weatherScenario'
  > & { cloudCoverAtSave?: number | null | undefined },
): ExposureEstimate {
  const at = new Date(v.selectedDatetimeUtc);
  const sun = sunPosition(at, v.latitude, v.longitude);
  const moon = moonPosition(at, v.latitude, v.longitude);
  const scenario =
    v.weatherMode === 'SCENARIO' && v.weatherScenario !== null && isScenarioId(v.weatherScenario)
      ? scenarioById(v.weatherScenario)
      : null;
  const cloud = v.cloudCoverAtSave ?? null;
  return estimateExposure({
    sunElevationDeg: sun.elevationDeg,
    sunTransmittance: scenario
      ? scenario.parameters.sunTransmittance
      : cloud !== null
        ? parametersForForecast({ cloudCoverTotal: cloud }).sunTransmittance
        : 1,
    moon: {
      elevationDeg: moon.topocentricElevationDeg,
      illuminatedFraction: moon.illuminatedFraction,
    },
  });
}
