'use client';
/** Field-view availability, kept apart from the view itself so the button does not pull its code in. */
import { compassSupported } from '@/features/field/use-compass';

/**
 * A phone (coarse pointer + compass) in a secure context with a camera API. Whether a camera
 * exists is only known when it is asked for; a laptop webcam without a compass is not useful here.
 */
export function fieldViewSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    compassSupported() &&
    (navigator.maxTouchPoints > 0 ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches))
  );
}
