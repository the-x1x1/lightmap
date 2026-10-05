'use client';
/** Field view (Phase 9): opens the live camera with the planned sun marked on it. */
import { useEffect, useState } from 'react';
import { fieldViewSupported } from '@/features/field/support';
import { usePlannerStore } from '@/features/planner/store';
import { Button } from '@lightmap/ui';

export function FieldViewButton() {
  const location = usePlannerStore((s) => s.location);
  const setFieldViewOpen = usePlannerStore((s) => s.setFieldViewOpen);
  // Decided on the client after mount so server and first client render agree.
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(fieldViewSupported()), []);
  if (!supported || !location) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => setFieldViewOpen(true)}
      data-testid="field-view-open"
    >
      Field view (camera)
    </Button>
  );
}
