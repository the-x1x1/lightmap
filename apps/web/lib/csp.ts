/**
 * Content-Security-Policy builder (plan §29). Used by middleware.ts per request with a nonce.
 * Cesium needs `blob:` workers and `wasm-unsafe-eval` (Draco / KTX decoders) — not `unsafe-eval`,
 * because we import @cesium/engine, not `cesium` (ADR-0002). 'strict-dynamic' lets nonce'd
 * scripts load Next's chunks and Cesium's lazy modules.
 */
const DATA_HOSTS = [
  'https://terrain.reearth.land',
  'https://api.open-meteo.com',
  'https://customer-api.open-meteo.com',
  'https://api.cesium.com',
  'https://assets.ion.cesium.com',
  'https://*.virtualearth.net',
  'https://dev.virtualearth.net',
  ...extraImageryHosts(process.env['IMAGERY_XYZ_URL']),
];

/** Origin of a tile template, wildcarded to its parent domain only when it has ≥ 3 labels (a.b.tld). */
export function extraImageryHosts(template: string | undefined): string[] {
  if (!template) return [];
  try {
    const u = new URL(template.replace(/\{[^}]+\}/g, 'x'));
    const labels = u.hostname.split('.');
    const wildcard = labels.length >= 3 ? `${u.protocol}//*.${labels.slice(1).join('.')}` : null;
    return wildcard ? [u.origin, wildcard] : [u.origin];
  } catch {
    return [];
  }
}

export function buildCsp(nonce: string, dev: boolean): string {
  const hosts = DATA_HOSTS.join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' blob:${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${hosts}`,
    `connect-src 'self' blob: data: ${hosts} https://api.stripe.com${dev ? ' ws: wss:' : ''}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "font-src 'self' data:",
    'frame-src https://js.stripe.com https://checkout.stripe.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
