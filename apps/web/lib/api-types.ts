/** Shapes shared between API routes and the client. Server types are the source; these are DTOs. */
import type { PublicProviderDescriptors } from '@lightmap/geospatial';
import type {
  ClimatologySummary,
  WeatherCapabilities,
  WeatherFrame,
  WeatherMode,
} from '@lightmap/weather';
import type { EntitlementSnapshot } from '@lightmap/entitlements';
import type { Place } from '@lightmap/geospatial';

export interface CapabilitiesResponse {
  providers: PublicProviderDescriptors;
  weather: WeatherCapabilities | null;
  fixtureMode: boolean;
  devBanner: boolean;
  flags: Record<string, boolean>;
  billingConfigured: boolean;
  /** The server records product events (plan §31); when false the client sends none. */
  analytics: boolean;
  /** Cesium ion tokens are public by design (scope them to the production domain in the ion dashboard); sent only when an ion provider is active. */
  ionToken?: string;
  authMethods: { email: boolean; google: boolean; devLogin: boolean };
}

export interface WeatherResponse {
  providerId: string;
  mode: WeatherMode;
  frames: WeatherFrame[];
  issuedAt: string;
  fetchedAt: string;
  cached: boolean;
  attribution: string;
}

/** "Typical for this month" — never a forecast (WEATHER_AND_FORECAST_MODEL.md §8). */
export interface ClimatologyResponse {
  summary: ClimatologySummary;
  cached: boolean;
  isFixture: boolean;
}

export interface LocationSearchResponse {
  results: Place[];
  provider: { id: string; isFixture: boolean; attribution: string };
}

export interface ReverseResponse {
  place: Place | null;
  timeZone: string;
  elevationM: number | null;
  provider: { id: string; isFixture: boolean; attribution: string };
}

export interface SolarDayResponse {
  date: string;
  timeZone: string;
  events: Record<string, string | null>;
  polar: string;
  notes: string[];
  daylightMinutes: number;
}

export interface EntitlementsResponse {
  signedIn: boolean;
  user: { id: string; email: string; displayName: string | null } | null;
  entitlements: EntitlementSnapshot;
  subscription: {
    status: string;
    planKey: string;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
  } | null;
}

/** Profile preferences (plan §17): `GET /api/account/profile`, patched by `PATCH`. */
export interface ProfileDto {
  units: 'metric' | 'imperial';
  /** Which zone the planner shows times in: the place's own, or the device's. */
  defaultTimezoneBehavior: 'location' | 'device';
  /** Full-frame-equivalent focal length the camera starts at for a new place, mm. */
  defaultLensEquivalentMm: number;
}

export interface ProfileResponse extends ProfileDto {
  /** False until the user has changed a preference: the values are the defaults, not a choice. */
  customized: boolean;
}

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  shootDate: string | null;
  createdAt: string;
  updatedAt: string;
  viewpointCount: number;
  /** Viewpoints whose instant is inside the provider's reliable forecast horizon right now. */
  upcomingViewpointCount: number;
}

export interface ViewpointDto {
  id: string;
  projectId: string;
  label: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string;
  headingDeg: number;
  pitchDeg: number;
  fieldOfViewDeg: number;
  focalLengthEquivalentMm: number | null;
  selectedDatetimeUtc: string;
  weatherMode: WeatherMode;
  weatherScenario: string | null;
  previewSourceType: 'REAL_REFERENCE' | 'SIMULATED_LIGHTING' | 'ESTIMATED_PREVIEW';
  /** Set when this is a shot variant (same place/camera, another time) of the named viewpoint. */
  parentViewpointId: string | null;
  createdAt: string;
  updatedAt: string;
  thumbnailDataUrl?: string | null;
}

export interface ProjectDetailDto extends ProjectDto {
  viewpoints: ViewpointDto[];
}

export interface ApiError {
  error: { code: string; message: string; upgradeTo?: string };
}
