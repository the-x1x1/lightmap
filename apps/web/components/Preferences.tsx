'use client';
/**
 * Preferences (plan §17): units, which zone times are shown in, and the lens a new place starts
 * with. The choices save as soon as they change — to the profile when signed in, to this device
 * otherwise — and the planner follows at once; the lens box saves when it is left (or Enter).
 */
import { useState } from 'react';
import { usePreferences, useUpdatePreferences } from '@/features/account/use-preferences';
import { useAccount } from '@/features/account/use-account';
import {
  DEFAULT_LENS_MAX_MM,
  DEFAULT_LENS_MIN_MM,
  type TimeZoneMode,
  type Units,
} from '@/lib/preferences';
import { RadioGroup } from '@lightmap/ui';

function isLens(mm: number): boolean {
  return Number.isInteger(mm) && mm >= DEFAULT_LENS_MIN_MM && mm <= DEFAULT_LENS_MAX_MM;
}

export function Preferences() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const account = useAccount();
  // The lens box shows what is being typed; the preference changes when the box is left.
  const [lensText, setLensText] = useState<string | null>(null);
  const lensValue = lensText ?? String(prefs.defaultLensEquivalentMm);
  const commitLens = () => {
    const mm = Number(lensText ?? '');
    if (lensText !== null && isLens(mm) && mm !== prefs.defaultLensEquivalentMm)
      update.mutate({ defaultLensEquivalentMm: mm });
    setLensText(null);
  };
  // Until the plan snapshot has answered, a change could land on the device just before the
  // profile loads and overrides it; the controls wait that out (a moment, once per page).
  const settling = account.isLoading && !account.snapshot;

  let status: string;
  if (update.isError)
    status = 'That change did not save; the previous setting is back. Try again in a moment.';
  else if (update.isSuccess)
    status = account.signedIn ? 'Saved to your account.' : 'Saved on this device.';
  else if (account.signedIn) status = 'Changes save to your account.';
  else status = 'Kept on this device. Sign in to carry them to your other devices.';

  return (
    <section className="space-y-3" aria-labelledby="lm-prefs-title" data-testid="preferences">
      <h3
        id="lm-prefs-title"
        className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]"
      >
        Preferences
      </h3>
      <fieldset className="space-y-3" disabled={settling}>
        <div>
          <div className="mb-1 text-xs text-[var(--lm-text-muted)]">Distances</div>
          <RadioGroup<Units>
            ariaLabel="Distance units"
            variant="grid"
            columns={2}
            value={prefs.units}
            onChange={(units) => update.mutate({ units })}
            options={[
              { value: 'metric', label: 'Metric (m, km, m/s)', testId: 'pref-units-metric' },
              { value: 'imperial', label: 'Imperial (ft, mi, mph)', testId: 'pref-units-imperial' },
            ]}
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-[var(--lm-text-muted)]">Times shown in</div>
          <RadioGroup<TimeZoneMode>
            ariaLabel="Time zone for times"
            variant="grid"
            columns={2}
            value={prefs.defaultTimezoneBehavior}
            onChange={(defaultTimezoneBehavior) => update.mutate({ defaultTimezoneBehavior })}
            options={[
              { value: 'location', label: "The place's zone", testId: 'pref-zone-location' },
              { value: 'device', label: "My device's zone", testId: 'pref-zone-device' },
            ]}
          />
          <p className="mt-1 text-xs text-[var(--lm-text-muted)]">
            {prefs.defaultTimezoneBehavior === 'device'
              ? 'Times read as your watch shows them; the place keeps its own zone when saved.'
              : 'Times read as a clock on the spot shows them.'}
          </p>
        </div>
        <label className="block text-xs text-[var(--lm-text-muted)]">
          Lens a new place starts with (mm, full-frame equivalent)
          <input
            type="number"
            inputMode="numeric"
            min={DEFAULT_LENS_MIN_MM}
            max={DEFAULT_LENS_MAX_MM}
            step={1}
            className="lm-input mt-1 w-full"
            value={lensValue}
            onChange={(e) => setLensText(e.target.value)}
            onBlur={commitLens}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitLens();
              }
            }}
            data-testid="pref-default-lens"
          />
        </label>
      </fieldset>
      <p className="text-xs text-[var(--lm-text-muted)]" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
