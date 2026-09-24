/**
 * Brand configuration. The product name is a WORKING NAME (plan §40). Nothing else in the
 * codebase may hardcode it: components read `brand.name`, billing reads `brand.billing.*`,
 * emails read `brand.support`. Rename here before launch and the whole product follows.
 */
export const brand = {
  /** Working name. */
  name: 'LightMap',
  tagline: 'See the light before you arrive.',
  /** One sentence for meta descriptions and store listings. */
  description:
    'A visual natural-light planner for photographers and filmmakers: pick a place, a date and a time, and see how the light should behave.',
  /** Short id used in storage keys, cookie prefixes and analytics namespaces. */
  slug: 'lightmap',
  urls: {
    marketing: 'https://lightmap.app',
    app: 'https://app.lightmap.app',
    support: 'mailto:support@formicaria.us',
    privacy: '/legal/privacy',
    terms: '/legal/terms',
  },
  billing: {
    /** Stripe product display names, kept here so the checkout page and the paywall agree. */
    proName: 'Photographer Pro',
    proDescription: 'Unrestricted date planning, projects, moon planning and high-quality previews.',
    freeName: 'Free',
  },
  colors: {
    chrome: '#0b0b0d',
    panel: '#16161a',
    panelRaised: '#1f1f25',
    text: '#f4f4f5',
    textMuted: '#a1a1aa',
    /** Warm sun/golden accent. */
    sun: '#f5b342',
    /** Cool twilight accent. */
    twilight: '#5b8def',
    danger: '#f26d6d',
  },
} as const;

export type Brand = typeof brand;
