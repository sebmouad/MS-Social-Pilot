"use client";
import { IconSearch } from "@tabler/icons-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Avatar } from "./Avatar";
import { useShellCopy } from "./ShellCopy";
import { fill } from "@/modules/shell/copy";
import type { ConnectionState } from "@/lib/connection-status";

export type ScopeChannel = { id: string; name: string; pictureUrl?: string | null; health: ConnectionState };

type ChannelScopeListProps = {
  channels: ScopeChannel[];
  /** Selected ids; empty means all channels. */
  selectedIds: readonly string[];
  onSelect: (id: string, additive: boolean) => void;
  onReset: () => void;
  /** Rows listed before "Show all (N)". */
  collapsedCount: number;
  /** Channel count from which a search field appears. */
  searchThreshold: number;
  manageHref?: string;
  /** Icon-only rail: names move to tooltips and accessible names. */
  compact?: boolean;
  /** Disabled while a navigation is pending. */
  busy?: boolean;
  /** Whether the current page is filtered by the channel scope. */
  scopeActive?: boolean;
};

/** Channel list that scopes every channel-aware page. Click = only this channel; Ctrl/⌘-click or the checkbox adds or removes one. */
export function ChannelScopeList({ channels, selectedIds, onSelect, onReset, collapsedCount, searchThreshold, manageHref, compact = false, busy = false, scopeActive = true }: ChannelScopeListProps) {
  const copy = useShellCopy();
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const searchable = channels.length > searchThreshold;
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => needle ? channels.filter(channel => channel.name.toLowerCase().includes(needle)) : channels, [channels, needle]);
  const expanded = showAll || needle !== "" || compact;
  const visible = expanded ? filtered : filtered.slice(0, collapsedCount);
  const hidden = filtered.length - visible.length;
  const allSelected = selectedIds.length === 0;
  const selected = new Set(selectedIds);

  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-scope-item]")];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]!.focus();
  };

  return <div className={`ui-scope${compact ? " is-compact" : ""}`}>
    {searchable && !compact && <label className="ui-scope__search"><IconSearch size={15} aria-hidden="true" /><input type="search" aria-label={copy.searchChannels} placeholder={copy.searchChannels} value={query} autoComplete="off" onChange={event => setQuery(event.target.value)} /></label>}
    <ul className="ui-scope__list" onKeyDown={onKey}>
      <li><button type="button" data-scope-item className={`ui-scope__item${allSelected && scopeActive ? " is-selected" : ""}`} aria-pressed={allSelected} disabled={busy} onClick={onReset} title={compact ? copy.allChannels : undefined}>
        <span className="ui-scope__all" aria-hidden="true">{channels.length}</span>
        <span className="ui-scope__name">{copy.allChannels}</span>
      </button></li>
      {visible.map(channel => {
        const on = selected.has(channel.id);
        const status = copy.channelStatus[channel.health];
        return <li key={channel.id} className="ui-scope__row">
          <button type="button" data-scope-item className={`ui-scope__item${on ? " is-selected" : ""}`} aria-pressed={on} disabled={busy} title={compact ? channel.name : undefined}
            onClick={event => onSelect(channel.id, event.ctrlKey || event.metaKey)}>
            <span className="ui-scope__avatar"><Avatar name={channel.name} src={channel.pictureUrl} size="sm" decorative /><span className={`ui-scope__dot is-${channel.health}`} aria-hidden="true" /></span>
            <span className="ui-scope__name">{channel.name}</span>
            {channel.health !== "connected" && <span className="ui-visually-hidden">{status}</span>}
          </button>
          {!compact && <input type="checkbox" className="ui-scope__check" checked={on} disabled={busy} aria-label={fill(copy.scopeToggle, { name: channel.name })}onChange={() => onSelect(channel.id, true)} />}
        </li>;
      })}
      {filtered.length === 0 && <li className="ui-scope__empty" role="status">{channels.length ? copy.noChannelMatch : copy.noChannels}</li>}
    </ul>
    {!compact && !needle && (hidden > 0 || (showAll && filtered.length > collapsedCount)) && <button type="button" className="ui-scope__more" onClick={() => setShowAll(value => !value)}>{showAll ? copy.showFewer : fill(copy.showAll, { count: filtered.length })}</button>}
    {!compact && manageHref && <a className="ui-scope__manage" href={manageHref}>{copy.manageChannels}</a>}
  </div>;
}
