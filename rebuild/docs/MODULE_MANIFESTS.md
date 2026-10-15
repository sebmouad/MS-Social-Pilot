# Customer module manifests

Each customer module owns its title, entry route, and feature routes in
`src/modules/<module>/manifest.ts`. The `ModuleManifest` shape is shared from
`src/modules/types.ts`; the catalog in `src/modules/index.ts` lists the
independent manifests used by the product.

`src/lib/product.ts` derives the existing `MODULES` and `PAGES` exports from
that catalog. The application shell uses these exports for module and feature
navigation, while configuration and access checks use them to generate module
and feature availability. Adding a customer feature to its manifest therefore
adds it to the shared navigation and availability catalog.

Home remains the landing module. Root routes are internal administration tools
and are deliberately not part of the customer module catalog.
