import { platformModule } from "@/platforms";

export type ChannelBadgeInfo = { platformName: string; mark: { text: string; color: string } };

/** Platform name and mark for a stored provider ID, from the module registry. */
export function channelBadgeInfo(provider: string | null | undefined): ChannelBadgeInfo {
  const module = provider ? platformModule(provider) : undefined;
  return module
    ? { platformName: module.name, mark: { text: module.mark.text, color: module.mark.color } }
    : { platformName: "Channel", mark: { text: "#", color: "var(--ink-soft)" } };
}
