'use client';

import { useState, type ReactNode } from 'react';

export type CampaignAccountTab = {
  id: string;
  name: string;
  meta?: string;
  badge: string;
  content: ReactNode;
};

/**
 * When multiple ad accounts return campaign results on the same page, show an
 * accessible account switcher bar so KPIs, charts, and hierarchy tables are
 * focused on one account at a time instead of repeating down the page.
 */
export function CampaignAccountSwitcher({ label, items }: { label: string; items: CampaignAccountTab[] }) {
  const [selectedId, setSelectedId] = useState<string>(() => items[0]?.id ?? '');
  if (items.length === 0) return null;
  if (items.length === 1) return <>{items[0]!.content}</>;
  const active = items.find(item => item.id === selectedId) ?? items[0]!;
  return (
    <div className="ads-account-switcher">
      <div className="ads-account-tabs" role="tablist" aria-label={label}>
        {items.map(item => {
          const isSelected = item.id === active.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className="ads-account-tab"
              onClick={() => setSelectedId(item.id)}
            >
              <span className="ads-account-tab__name">{item.name}</span>
              {item.meta ? <small className="ads-account-tab__meta">{item.meta}</small> : null}
              <span className="badge">{item.badge}</span>
            </button>
          );
        })}
      </div>
      {active.content}
    </div>
  );
}
