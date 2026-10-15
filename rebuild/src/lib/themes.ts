/** Shared theme metadata, safe to import from server and client modules. */
export const THEME_COOKIE = 'social-pilot-theme';
export const THEMES = [
  { id: 'grove', name: 'Grove', description: 'Soft greens with a calm, natural feel.', swatches: ['#f5f7f4', '#286b4b', '#e4f2e9'] },
  { id: 'coast', name: 'Coast', description: 'Cool blues inspired by open water and sky.', swatches: ['#f2f7fa', '#17698a', '#dff0f7'] },
  { id: 'clay', name: 'Clay', description: 'Warm terracotta with a soft, earthy canvas.', swatches: ['#fbf5f0', '#a54e2c', '#f6e5db'] },
  { id: 'nightfall', name: 'Nightfall', description: 'A deep slate workspace with softened contrast.', swatches: ['#111a20', '#79c8a2', '#24483b'] },
] as const;
export type ThemeId = typeof THEMES[number]['id'];
