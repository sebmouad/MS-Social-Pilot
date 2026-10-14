# Workspace themes

Social Pilot offers four selectable palettes: Grove, Coast, Clay, and Nightfall. Grove is the default. The appearance screen at `/settings/appearance` previews each palette and applies it immediately.

## Implementation

`src/styles/tokens.css` defines the shared color tokens and theme overrides on `:root[data-theme]`. Components should use these tokens for surfaces, text, borders, focus rings, and status colors rather than fixed palette values. Add any new shared color token to each theme so that a component keeps its intended contrast in every palette.

The selected theme is stored in the `social-pilot-theme` cookie for one year with `Path=/` and `SameSite=Lax`. It is a presentation preference, so it is readable by the client and does not contain account data. On HTTPS, the browser also receives the `Secure` flag. The root layout reads and validates this value on the server, then writes `data-theme` to the document before rendering. This avoids a flash of the default palette when a saved theme is active.

The `ThemeProvider` updates the document immediately when the user selects a palette and refreshes its React state. No browser storage or network request is needed. Unsupported or missing cookie values fall back to Grove.

## Accessibility

Theme controls are native buttons with pressed state, visible focus, and text descriptions. Status is conveyed with text and shape in addition to color. Nightfall uses browser dark control styling and retains a high-contrast focus ring. Reduced-motion preferences are respected by the shared stylesheet.
