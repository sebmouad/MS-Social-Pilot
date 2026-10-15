export type ChannelMark = { text: string; color: string };

/**
 * A channel's name with its platform mark. The mark comes from the platform
 * module registry (resolved on the server and passed in), so shared screens
 * never name a platform themselves. Compact mode shows the mark alone with the
 * full name kept for assistive technology and the tooltip.
 */
export function ChannelBadge({ name, platformName, mark, compact = false }: { name: string; platformName: string; mark: ChannelMark; compact?: boolean }) {
  return <span className={`ui-channel${compact ? " ui-channel--compact" : ""}`} title={`${name} · ${platformName}`}>
    <span className="ui-channel__mark" style={{ background: mark.color }} aria-hidden="true">{mark.text}</span>
    <span className={compact ? "ui-visually-hidden" : "ui-channel__name"}>{name}<span className="ui-visually-hidden"> on {platformName}</span></span>
  </span>;
}
