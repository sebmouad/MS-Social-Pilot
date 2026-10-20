import { IconArrowDown, IconArrowUp, IconArrowsSort, IconInbox } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { IndeterminateCheckbox } from "./IndeterminateCheckbox";
import { Menu, type MenuItem } from "./Menu";

export type TableColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "start" | "end";
  sortable?: boolean;
  /** Fixed width such as "120px"; other columns share the rest. */
  width?: string;
  /** Hide the column label in the phone card layout (for columns that are self-explanatory, such as a title). */
  hideCardLabel?: boolean;
};

type DataTableProps<T> = {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  emptyMessage?: string;
  /** Next step shown under the empty message, for example a create or clear-filters button. */
  emptyAction?: ReactNode;
  /** Glyph above the empty message. */
  emptyIcon?: ReactNode;
  sort?: { key: string; direction: "ascending" | "descending"; onChange: (key: string) => void };
  /** Compact rows suit long operational lists; comfortable is the default. */
  density?: "comfortable" | "compact";
  /** Show placeholder rows instead of the empty message while data is on its way. */
  loading?: boolean;
  loadingLabel?: string;
  /** Row checkboxes with a select-all header. The caller owns the selected keys. */
  selection?: { selected: readonly string[]; onChange: (keys: string[]) => void; rowLabel: (row: T) => string; selectAllLabel: string };
  /** Kebab menu per row. Put the frequent action in a visible column instead; keep the menu for secondary actions. */
  rowActions?: (row: T) => MenuItem[];
  rowActionsLabel?: (row: T) => string;
  /** Header stays visible while the page scrolls inside the region. Default true. */
  stickyHeader?: boolean;
  /** Alternate row tint. Default true. */
  zebra?: boolean;
  /** Below 480px each row becomes a labeled card instead of scrolling sideways. Default true. */
  stackOnPhone?: boolean;
  /** Called when a row body is activated with the mouse; keep a real link or button in the row for keyboard users. */
  onRowClick?: (row: T) => void;
};

const LOADING_ROWS = 5;

function SortIcon({ active, direction }: { active: boolean; direction?: "ascending" | "descending" }) {
  const Icon = !active ? IconArrowsSort : direction === "ascending" ? IconArrowUp : IconArrowDown;
  return <Icon size={14} stroke={1.9} aria-hidden="true" className={`ui-table__sort-icon${active ? " is-active" : ""}`} />;
}

export function DataTable<T>({ columns, rows, rowKey, caption, emptyMessage = "Nothing to show yet.", emptyAction, emptyIcon, sort, density = "comfortable", loading = false, loadingLabel = "Loading…", selection, rowActions, rowActionsLabel, stickyHeader = true, zebra = true, stackOnPhone = true, onRowClick }: DataTableProps<T>) {
  const showEmpty = !loading && !rows.length;
  const selected = new Set(selection?.selected ?? []);
  const allKeys = rows.map(rowKey);
  const selectedCount = allKeys.filter(key => selected.has(key)).length;
  const toggle = (key: string) => selection?.onChange(selected.has(key) ? [...selected].filter(item => item !== key) : [...selected, key]);
  const columnCount = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);
  const className = ["ui-table", density === "compact" && "ui-table--compact", stickyHeader && "ui-table--sticky", zebra && "ui-table--zebra", stackOnPhone && "ui-table--stack", onRowClick && "ui-table--clickable"].filter(Boolean).join(" ");

  return <div className="ui-table-shell"><div className={`ui-table-wrap${rows.length || loading ? '' : ' is-empty'}`} role="region" aria-label={caption} aria-busy={loading || undefined} tabIndex={0}>
    <table className={className}><caption className="ui-visually-hidden">{caption}</caption>
      <colgroup>{selection && <col className="ui-table__col-check" />}{columns.map(column => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}{rowActions && <col className="ui-table__col-actions" />}</colgroup>
      <thead><tr>
        {selection && <th scope="col" className="ui-table__check"><IndeterminateCheckbox indeterminate={selectedCount > 0 && selectedCount < allKeys.length} aria-label={selection.selectAllLabel} checked={allKeys.length > 0 && selectedCount === allKeys.length} disabled={!allKeys.length} onChange={() => selection.onChange(selectedCount === allKeys.length ? [] : allKeys)} /></th>}
        {columns.map(column => <th key={column.key} scope="col" className={column.align === "end" ? "is-end" : ""} aria-sort={column.sortable && sort ? sort.key === column.key ? sort.direction : "none" : undefined}>
          {column.sortable && sort ? <button type="button" className="ui-table__sort" onClick={() => sort.onChange(column.key)}><span>{column.label}</span><SortIcon active={sort.key === column.key} direction={sort.direction} /></button> : column.label}
        </th>)}
        {rowActions && <th scope="col" className="ui-table__actions"><span className="ui-visually-hidden">{caption}</span></th>}
      </tr></thead>
      <tbody>{loading
        ? Array.from({ length: LOADING_ROWS }, (_, index) => <tr key={`loading-${index}`} aria-hidden="true">{Array.from({ length: columnCount }, (_, cell) => <td key={cell}><span className="ui-skeleton" /></td>)}</tr>)
        : rows.map(row => {
          const key = rowKey(row);
          const isSelected = selected.has(key);
          return <tr key={key} aria-selected={selection ? isSelected : undefined} className={isSelected ? "is-selected" : undefined}
            onClick={onRowClick ? event => { if (!(event.target as HTMLElement).closest("a,button,input,select,textarea,label,[role=menu]")) onRowClick(row); } : undefined}>
            {selection && <td className="ui-table__check"><input type="checkbox" aria-label={selection.rowLabel(row)} checked={isSelected} onChange={() => toggle(key)} /></td>}
            {columns.map(column => <td key={column.key} className={column.align === "end" ? "is-end" : ""} data-label={column.hideCardLabel ? undefined : column.label}>{column.render(row)}</td>)}
            {rowActions && <td className="ui-table__actions"><Menu label={rowActionsLabel?.(row) ?? "Row actions"} items={rowActions(row)} /></td>}
          </tr>;
        })}</tbody>
    </table>
  </div>
  {loading && <p className="ui-visually-hidden" role="status">{loadingLabel}</p>}
  {showEmpty && <div className="ui-table-empty" role="status"><span className="ui-state__icon" aria-hidden="true">{emptyIcon ?? <IconInbox size={22} stroke={1.6} />}</span><p>{emptyMessage}</p>{emptyAction && <div className="ui-table-empty__action">{emptyAction}</div>}</div>}</div>;
}
