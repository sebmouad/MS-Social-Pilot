import type { CSSProperties } from 'react';

type Mark = { text: string; color: string };

/** A platform badge: the module's own mark on its own colour. Decorative; the name always sits beside it. */
export function PlatformMark({ mark }: { mark: Mark | null | undefined }) {
  return <span className="ui-mark" style={{ '--mark-color': mark?.color } as CSSProperties} aria-hidden="true">{mark?.text ?? '•'}</span>;
}

/** A channel name with its platform badge. The platform name is available to assistive technology. */
export function ChannelChip({ name, platform, mark }: { name: string; platform?: string | null; mark?: Mark | null }) {
  return <span className="ui-chip" title={platform ? `${name} · ${platform}` : name}>
    <PlatformMark mark={mark} />
    <span>{name}{platform ? <span className="ui-visually-hidden"> ({platform})</span> : null}</span>
  </span>;
}
