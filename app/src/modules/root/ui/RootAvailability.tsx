import { AVAILABILITY_CATALOG } from '@/lib/config/registry';

/** Installation availability inventory for one module (or everything): which modules and features exist to switch. */
export function RootAvailability({ modules, features, copy }: {
  modules: ReadonlyArray<(typeof AVAILABILITY_CATALOG.modules)[number]>;
  features: ReadonlyArray<(typeof AVAILABILITY_CATALOG.features)[number]>;
  copy: { inventory: string; inventoryDescription: string; modules: string; features: string };
}) {
  return <section className="root-config__catalog">
    <h2>{copy.inventory}</h2>
    <p>{copy.inventoryDescription}</p>
    <h3>{copy.modules}</h3>
    <ul>{modules.map(module => <li key={module.id}>{module.title} <code>{module.id}</code></li>)}</ul>
    <h3>{copy.features}</h3>
    <ul>{features.map(feature => <li key={feature.id}>{feature.title} <code>{feature.id}</code> · {feature.module}</li>)}</ul>
  </section>;
}
