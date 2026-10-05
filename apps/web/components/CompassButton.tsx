'use client';
/** Field mode (Phase 9): "Point with phone" — the viewpoint camera follows the phone's back camera. */
import { useCompass } from '@/features/field/use-compass';
import { Button } from '@lightmap/ui';

const NOTES: Record<string, string> = {
  denied:
    'Motion & orientation access was not allowed. Enable it in the browser settings and try again.',
  'no-compass': 'This device gives no compass heading, so the camera cannot follow it.',
  requesting: 'Waiting for the first reading… hold the phone up like a camera.',
  active: 'Following the phone. Drag, use a slider or tap Stop to take over.',
};

export function CompassButton() {
  const { state, start, stop } = useCompass();
  if (state === 'unsupported') return null;
  const on = state === 'active' || state === 'requesting';
  return (
    <div className="mt-2 space-y-1" data-testid="compass">
      <Button
        size="sm"
        variant={on ? 'primary' : 'secondary'}
        aria-pressed={on}
        onClick={() => (on ? stop() : start())}
        data-testid="compass-toggle"
      >
        {on ? 'Stop following phone' : 'Point with phone'}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className="text-xs text-[var(--lm-text-muted)]"
        data-testid="compass-status"
      >
        {NOTES[state] ?? ''}
      </p>
    </div>
  );
}
