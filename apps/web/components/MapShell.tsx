'use client';
/**
 * MapShell (plan §4, §20): full-screen map; top bar with logo, search, account; a planning panel
 * that is a draggable bottom sheet on phones and a side panel on desktop. One primary workflow:
 * Location → Date → Time → Conditions → Preview → Save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { brand, isEnabled } from '@lightmap/config';
import { civilDateString, utcToWallClock } from '@lightmap/astronomy';
import { DEFAULT_RENDER_SETTINGS } from '@lightmap/scene';
import { usePlannerStore } from '@/features/planner/store';
import { useScene } from '@/features/planner/use-scene';
import { useAccount } from '@/features/account/use-account';
import { Button, cx } from '@lightmap/ui';
import { WorldMap, type RendererInfo } from './WorldMap';
import { LocationSearch } from './LocationSearch';
import { Timeline } from './Timeline';
import { DateControl } from './DateControl';
import { WeatherScenarioPicker } from './WeatherScenarioPicker';
import { PreviewViewport } from './PreviewViewport';
import { ConfidencePanel } from './ConfidencePanel';
import { CameraControls } from './CameraControls';
import { AstronomyDetails } from './AstronomyDetails';
import { LightFinder } from './LightFinder';
import { ClimatologyPanel } from './ClimatologyPanel';
import { HourlyOutlook } from './HourlyOutlook';
import { WeatherDetails } from './WeatherDetails';
import { ProjectDrawer } from './ProjectDrawer';
import { AccountMenu, AccountPanel } from './AccountMenu';
import { DevBanner } from './DevBanner';
import { PerfPanel } from './PerfPanel';
import { OfflineState } from './states/OfflineState';
import { EmptyState } from './states/EmptyState';
import { ErrorState } from './states/ErrorState';
import { Paywall } from './Paywall';
import { AttributionFooter } from './AttributionFooter';

export function MapShell() {
  const panel = usePlannerStore((s) => s.panel);
  const setPanel = usePlannerStore((s) => s.setPanel);
  const previewExpanded = usePlannerStore((s) => s.previewExpanded);
  const location = usePlannerStore((s) => s.location);
  const date = usePlannerStore((s) => s.date);
  const showPerf = usePlannerStore((s) => s.showPerfPanel);
  const togglePerf = usePlannerStore((s) => s.togglePerfPanel);
  const reducedMotion = usePlannerStore((s) => s.reducedMotion);
  const setReducedMotion = usePlannerStore((s) => s.setReducedMotion);
  const sheetOpen = usePlannerStore((s) => s.sheetOpen);
  const setSheetOpen = usePlannerStore((s) => s.setSheetOpen);
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);
  const [desktop, setDesktop] = useState(false);
  const account = useAccount();
  const [rendererInfo, setRendererInfo] = useState<RendererInfo>({
    mode: 'loading',
    qualityLabel: '—',
    getStats: () => null,
    error: null,
    capabilities: null,
    capture: () => Promise.resolve(null),
  });

  const render = useMemo(() => ({ ...DEFAULT_RENDER_SETTINGS, reducedMotion }), [reducedMotion]);
  const bundle = useScene({
    render,
    includeLunar: account.can('moon_planning').allowed || !account.snapshot,
  });
  const { scene, dayEvents, capabilities, weather } = bundle;

  // Free-plan date window (plan §38): explain, never block silently. "Today" is the location's
  // civil date so the decision matches the server's.
  const today = civilDateString(
    utcToWallClock(
      new Date(),
      location?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  );
  const dateDecision = account.snapshot
    ? account.can('future_date_planning', { targetDate: date, today })
    : { allowed: true, key: 'future_date_planning' as const };
  // Signed-out visitors get the free window; the server never sees these searches anyway.
  const finderDecision = account.snapshot
    ? account.can('reverse_planning')
    : { allowed: false, key: 'reverse_planning' as const, reason: undefined };

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onMotion = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onMotion);
    const wide = window.matchMedia('(min-width: 1024px)');
    setDesktop(wide.matches);
    const onWide = (e: MediaQueryListEvent) => setDesktop(e.matches);
    wide.addEventListener('change', onWide);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`' && process.env.NODE_ENV !== 'production' && isEnabled('perfPanel'))
        togglePerf();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      mq.removeEventListener('change', onMotion);
      wide.removeEventListener('change', onWide);
      window.removeEventListener('keydown', onKey);
    };
  }, [setReducedMotion, togglePerf]);

  // Panel swaps unmount the control that had focus (e.g. "Save to project" → Projects). Move focus
  // to the panel body so keyboard and screen-reader users are not dropped on <body> (plan §28).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    panelBodyRef.current?.focus({ preventScroll: true });
  }, [panel]);
  // Collapsing the preview restores focus to the control that expands it.
  useEffect(() => {
    if (!previewExpanded && !firstRender.current) expandButtonRef.current?.focus();
  }, [previewExpanded]);

  const captureThumbnail = useCallback(() => rendererInfo.capture(), [rendererInfo]);
  const onRendererInfo = useCallback((info: RendererInfo) => setRendererInfo(info), []);

  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-[var(--lm-chrome)]"
      data-testid="map-shell"
    >
      <DevBanner caps={capabilities} />
      <OfflineState />
      {/* Map is the hero. */}
      <div
        className={cx(
          'absolute inset-0 transition-[inset] duration-300',
          !previewExpanded && 'lg:right-[420px]',
        )}
      >
        {/* Top bar first in the DOM so Tab reaches search before the map. */}
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 p-3 pt-6 lg:pt-3">
          <h1 className="sr-only">{brand.name}</h1>
          <a
            href="/"
            className="pointer-events-auto flex h-11 items-center gap-2 rounded-full bg-black/55 px-3 text-sm font-semibold backdrop-blur"
            aria-label={`${brand.name} home`}
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full bg-[var(--lm-sun)] shadow-[0_0_12px_var(--lm-sun)]"
            />
            {brand.name}
          </a>
          <div className="pointer-events-auto flex-1 max-w-xl">
            <LocationSearch />
          </div>
          <div className="pointer-events-auto">
            <AccountMenu />
          </div>
        </header>
        <WorldMap scene={scene} capabilities={capabilities} onRendererInfo={onRendererInfo} />
        {!location ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-[42%] z-10 flex justify-center px-4 lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2">
            <div className="pointer-events-auto">
              <EmptyState
                title="Where will you shoot?"
                body="Search a place, paste coordinates, or tap the globe. Then pick a date and drag the timeline to see how the light behaves."
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Planning panel: bottom sheet (mobile) / right panel (desktop). */}
      {!previewExpanded ? (
        <aside
          className={cx(
            'lm-sheet-in absolute inset-x-0 bottom-0 z-30 flex max-h-[62dvh] flex-col rounded-t-2xl border-t border-[var(--lm-panel-border)] bg-[var(--lm-panel)]/95 shadow-[var(--lm-shadow)] backdrop-blur',
            'lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[420px] lg:rounded-none lg:border-l lg:border-t-0',
            !sheetOpen && 'max-h-[88px] lg:max-h-none',
          )}
          id="planning-panel"
          aria-label="Planning panel"
          data-testid="planning-panel"
        >
          <button
            type="button"
            className="mx-auto mt-2 h-6 w-full max-w-[120px] lg:hidden"
            aria-label={sheetOpen ? 'Collapse panel' : 'Expand panel'}
            aria-expanded={sheetOpen}
            aria-controls="planning-panel-body"
            onClick={() => setSheetOpen(!sheetOpen)}
          >
            <span className="mx-auto block h-1.5 w-10 rounded-full bg-white/30" />
          </button>
          {/* `inert` while collapsed on phones: the clipped tabs and body must not take focus. */}
          <nav
            className="flex gap-1 px-3 pt-1 lg:pt-4"
            aria-label="Panel sections"
            inert={!sheetOpen && !desktop ? true : undefined}
          >
            {(['plan', 'projects', 'account'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPanel(p)}
                aria-pressed={panel === p}
                className={cx(
                  'h-9 rounded-full px-3 text-sm capitalize',
                  panel === p
                    ? 'bg-white/12 text-[var(--lm-text)]'
                    : 'text-[var(--lm-text-muted)] hover:text-[var(--lm-text)]',
                )}
                data-testid={`panel-tab-${p}`}
              >
                {p}
              </button>
            ))}
          </nav>
          <div
            id="planning-panel-body"
            ref={panelBodyRef}
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3 outline-none lg:pb-4"
            data-testid="panel-body"
            inert={!sheetOpen && !desktop ? true : undefined}
          >
            {panel === 'plan' ? (
              <div className="space-y-5">
                {location ? (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
                      Location
                    </div>
                    <div className="truncate text-sm" data-testid="location-label">
                      {location.label}
                    </div>
                    <div className="text-xs text-[var(--lm-text-muted)]">
                      {location.point.latitude.toFixed(4)}, {location.point.longitude.toFixed(4)} ·{' '}
                      {location.timeZone}
                    </div>
                  </div>
                ) : null}
                <DateControl
                  blockedReason={dateDecision.allowed ? null : (dateDecision.reason ?? null)}
                />
                {!dateDecision.allowed ? (
                  <Paywall compact reason={dateDecision.reason ?? ''} />
                ) : null}
                <Timeline
                  dayEvents={dayEvents}
                  timeZone={location?.timeZone ?? 'UTC'}
                  phase={scene?.solar.phase}
                />
                {scene ? (
                  <HourlyOutlook
                    scene={scene}
                    frames={weather.frames}
                    mode={weather.mode}
                    decision={
                      account.snapshot
                        ? account.can('forecast_detail')
                        : {
                            allowed: false,
                            key: 'forecast_detail',
                            reason: 'Sign in with Pro for hour-by-hour forecast detail.',
                          }
                    }
                  />
                ) : null}
                {scene ? (
                  <>
                    <WeatherScenarioPicker scene={scene} weatherLoading={weather.loading} />
                    <ClimatologyPanel
                      scene={scene}
                      decision={
                        account.snapshot
                          ? account.can('climatology')
                          : {
                              allowed: false,
                              key: 'climatology',
                              reason: 'Sign in with Pro to see typical conditions for any month.',
                            }
                      }
                    />
                    {weather.providerFailed ? (
                      <ErrorState
                        live="status"
                        title="Live forecast unavailable"
                        body="Showing your selected scenario. Astronomy is unaffected."
                      />
                    ) : null}
                    <PreviewViewport
                      scene={scene}
                      rendererMode={rendererInfo.mode}
                      capture={rendererInfo.capture}
                      exportDecision={account.can('export_preview')}
                      expandButtonRef={expandButtonRef}
                    />
                    {rendererInfo.error && rendererInfo.mode !== 'OVERLAY' ? (
                      <ErrorState live="status" title="Renderer notice" body={rendererInfo.error} />
                    ) : null}
                    <CameraControls
                      advancedAllowed={account.can('advanced_camera_tools').allowed}
                    />
                    <ConfidencePanel scene={scene} />
                    <details data-testid="details-light-finder">
                      <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
                        Light finder — when is the sun{' '}
                        <em className="not-italic normal-case">there</em>?
                      </summary>
                      <div className="mt-2">
                        <LightFinder
                          scene={scene}
                          allowed={finderDecision.allowed}
                          reason={finderDecision.allowed ? null : (finderDecision.reason ?? null)}
                          windowDays={{
                            ahead: account.snapshot?.limits.futureDateWindowDays ?? 14,
                            back: account.snapshot?.limits.pastDateWindowDays ?? 7,
                          }}
                          moonAllowed={account.can('moon_planning').allowed || !account.snapshot}
                        />
                      </div>
                    </details>
                    <details data-testid="details-astronomy">
                      <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
                        Sun &amp; moon details
                      </summary>
                      <div className="mt-2">
                        <AstronomyDetails scene={scene} />
                      </div>
                    </details>
                    <details data-testid="details-weather">
                      <summary className="cursor-pointer text-xs uppercase tracking-wide text-[var(--lm-text-muted)]">
                        Weather details
                      </summary>
                      <div className="mt-2">
                        <WeatherDetails scene={scene} />
                      </div>
                    </details>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        className="flex-1"
                        onClick={() => setPanel('projects')}
                        data-testid="save-to-project"
                      >
                        Save to project
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-[var(--lm-text-muted)]">
                    Choose a location to see the light.
                  </p>
                )}
              </div>
            ) : null}
            {panel === 'projects' ? (
              <ProjectDrawer scene={scene} captureThumbnail={captureThumbnail} />
            ) : null}
            {panel === 'account' ? <AccountPanel /> : null}
          </div>
          <AttributionFooter caps={capabilities} scene={scene} />
        </aside>
      ) : (
        <div className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2">
          <Button
            variant="secondary"
            autoFocus
            onClick={() => usePlannerStore.getState().setPreviewExpanded(false)}
            data-testid="preview-collapse"
          >
            Show controls
          </Button>
        </div>
      )}
      {showPerf && scene ? (
        <PerfPanel
          scene={scene}
          getStats={rendererInfo.getStats}
          qualityLabel={rendererInfo.qualityLabel}
          rendererMode={rendererInfo.mode}
          capabilities={rendererInfo.capabilities}
          weatherCached={null}
        />
      ) : null}
    </div>
  );
}
