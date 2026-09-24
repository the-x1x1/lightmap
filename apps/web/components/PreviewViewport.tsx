'use client';
/**
 * Preview panel (plan §4): the hero readout beside/below the map — source badge, time, sun,
 * scenario, sunrise/sunset. The 3D view itself IS the preview; this frames it with the facts and
 * offers "expand" for full-screen on mobile.
 */
import type { SceneState } from '@lightmap/scene';
import { formatWallTime } from '@lightmap/astronomy';
import { compassLabel } from '@lightmap/geospatial';
import { scenarioById } from '@lightmap/weather';
import { lightingFromScene } from '@lightmap/renderer';
import { useState, type Ref } from 'react';
import type { EntitlementDecision } from '@lightmap/entitlements';
import { usePlannerStore } from '@/features/planner/store';
import { Button } from '@lightmap/ui';
import { PreviewSourceBadge } from './PreviewSourceBadge';
import { ForecastBadge } from './ForecastBadge';
import { TerrainHorizonBadge } from './TerrainHorizonBadge';
import { Paywall } from './Paywall';

export function PreviewViewport({
  scene,
  rendererMode,
  capture,
  exportDecision,
  expandButtonRef,
}: {
  scene: SceneState;
  rendererMode: '3D' | 'OVERLAY' | 'loading';
  /** Current frame as a data URL at the requested width; null when no 3D renderer is active. */
  capture?: (maxWidth?: number) => Promise<string | null>;
  /** `export_preview` decision; undefined hides the export control. */
  exportDecision?: EntitlementDecision | undefined;
  /** Lets the shell return focus here after the expanded preview is collapsed. */
  expandButtonRef?: Ref<HTMLButtonElement>;
}) {
  const expanded = usePlannerStore((s) => s.previewExpanded);
  const setExpanded = usePlannerStore((s) => s.setPreviewExpanded);
  const light = lightingFromScene(scene);
  const tz = scene.location.timeZone;
  const s = scene.solar;
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done' | 'paywall' | 'error'>(
    'idle',
  );

  async function exportCard() {
    if (!exportDecision) return;
    if (!exportDecision.allowed) {
      setExportState('paywall');
      return;
    }
    setExportState('busy');
    try {
      // Loaded on demand: the card renderer is not part of the first-load bundle (plan §27).
      const { buildPlanningCard, downloadBlob, renderPlanningCardPng } =
        await import('@/features/export/planning-card');
      const image = capture ? await capture(1280) : null;
      const model = buildPlanningCard(scene, {
        generatedAt: new Date(),
        ...(typeof window !== 'undefined' ? { appUrl: window.location.origin } : {}),
      });
      const blob = await renderPlanningCardPng(model, image);
      downloadBlob(blob, model.fileName);
      setExportState('done');
    } catch {
      setExportState('error');
    }
  }

  return (
    <section aria-labelledby="lm-preview-h" className="space-y-2" data-testid="preview-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="lm-preview-h" className="sr-only">
          Preview
        </h2>
        <PreviewSourceBadge mode={scene.sourceMode} />
        <ForecastBadge scene={scene} />
        <TerrainHorizonBadge scene={scene} />
        <span className="ml-auto flex items-center gap-1">
          {exportDecision ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void exportCard()}
              disabled={exportState === 'busy'}
              data-testid="preview-export"
            >
              {exportState === 'busy' ? 'Exporting…' : 'Export card'}
              <span className="sr-only"> (PNG planning card)</span>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            ref={expandButtonRef}
            onClick={() => setExpanded(!expanded)}
            data-testid="preview-expand"
          >
            {expanded ? 'Show controls' : 'Expand preview'}
          </Button>
        </span>
      </div>
      <span className="sr-only" role="status">
        {exportState === 'busy'
          ? 'Exporting planning card…'
          : exportState === 'done'
            ? 'Planning card downloaded.'
            : ''}
      </span>
      {exportState === 'paywall' && exportDecision ? (
        <Paywall compact reason={exportDecision.reason ?? 'Planning-card export is part of Pro.'} />
      ) : null}
      {exportState === 'error' ? (
        <p role="alert" className="text-xs text-[color:#ffb3b3]">
          Export failed in this browser. The facts above are the same as the card would show.
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <Stat
          label="Local time"
          value={scene.localTime.time}
          sub={scene.localTime.zoneAbbreviation}
          testId="preview-time"
        />
        <Stat
          label="Sun"
          value={
            s.elevationDegrees > -0.833
              ? `${s.elevationDegrees.toFixed(0)}° up`
              : `${Math.abs(s.elevationDegrees).toFixed(0)}° below`
          }
          sub={`${Math.round(s.azimuthDegrees)}° ${compassLabel(s.azimuthDegrees)}`}
          testId="preview-sun"
        />
        <Stat
          label={scene.atmosphere.mode === 'SCENARIO' ? 'Scenario' : 'Weather'}
          value={scenarioById(scene.atmosphere.scenario).label}
          sub={`${Math.round(scene.atmosphere.parameters.sunTransmittance * 100)} % direct`}
          testId="preview-scenario"
        />
        <Stat
          label="Sunrise"
          value={scene.dayEvents.sunrise ? formatWallTime(scene.dayEvents.sunrise, tz) : '—'}
          sub={
            scene.dayEvents.polar !== 'normal' ? scene.dayEvents.polar.replace('-', ' ') : 'local'
          }
          testId="preview-sunrise"
        />
        <Stat
          label="Sunset"
          value={scene.dayEvents.sunset ? formatWallTime(scene.dayEvents.sunset, tz) : '—'}
          sub={
            scene.dayEvents.goldenHourEveningStart
              ? `golden ${formatWallTime(scene.dayEvents.goldenHourEveningStart, tz)}`
              : ''
          }
          testId="preview-sunset"
        />
        <Stat
          label="Light"
          value={`${Math.round(scene.atmosphere.colorTemperatureK)} K`}
          sub={s.phase.replace('-', ' ')}
          testId="preview-light"
        />
      </div>
      <div
        aria-hidden
        className="h-2 w-full rounded-full"
        style={{
          background: `linear-gradient(90deg, ${light.skyGradient[0]}, ${light.skyGradient[1]}, ${light.skyGradient[2]})`,
        }}
        title="Sky gradient for this moment"
      />
      {rendererMode === 'OVERLAY' ? (
        <p className="text-xs text-[var(--lm-text-muted)]">
          3D preview unavailable on this device; the overlay shows exact light direction.
        </p>
      ) : null}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-[var(--lm-radius-sm)] bg-white/5 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--lm-text-muted)]">{label}</div>
      <div className="font-mono text-base tabular-nums" data-testid={testId}>
        {value}
      </div>
      {sub ? <div className="truncate text-[11px] text-[var(--lm-text-muted)]">{sub}</div> : null}
    </div>
  );
}
