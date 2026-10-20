import type { ReactNode } from "react";

export type TableColumn<T> = { key: string; label: string; render: (row: T) => ReactNode; align?: "start" | "end"; sortable?: boolean };
type DataTableProps<T> = {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  emptyMessage?: string;
  /** Next step shown under the empty message, for example a create or clear-filters button. */
  emptyAction?: ReactNode;
  sort?: { key: string; direction: "ascending" | "descending"; onChange: (key: string) => void };
  /** Compact rows suit long operational lists; comfortable is the default. */
  density?: "comfortable" | "compact";
  /** Show placeholder rows instead of the empty message while data is on its way. */
  loading?: boolean;
  loadingLabel?: string;
};

const LOADING_ROWS = 5;

export function DataTable<T>({ columns, rows, rowKey, caption, emptyMessage = "Nothing to show yet.", emptyAction, sort, density = "comfortable", loading = false, loadingLabel = "Loading…" }: DataTableProps<T>) {
  const showEmpty = !loading && !rows.length;
  return <div className="ui-table-shell"><div className={`ui-table-wrap${rows.length || loading ? '' : ' is-empty'}`} role="region" aria-label={caption} aria-busy={loading || undefined} tabIndex={0}>
    <table className={`ui-table${density === "compact" ? " ui-table--compact" : ""}`}><caption className="ui-visually-hidden">{caption}</caption>
      <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={column.align === "end" ? "is-end" : ""} aria-sort={column.sortable && sort ? sort.key === column.key ? sort.direction : "none" : undefined}>
        {column.sortable && sort ? <button type="button" className="ui-table__sort" onClick={() => sort.onChange(column.key)}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === "ascending" ? " ↑" : " ↓" : " ↕"}</span></button> : column.label}
      </th>)}</tr></thead>
      <tbody>{loading
        ? Array.from({ length: LOADING_ROWS }, (_, index) => <tr key={`loading-${index}`} aria-hidden="true">{columns.map(column => <td key={column.key}><span className="ui-skeleton" /></td>)}</tr>)
        : rows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.key} className={column.align === "end" ? "is-end" : ""}>{column.render(row)}</td>)}</tr>)}</tbody>
    </table>
  </div>
  {loading && <p className="ui-visually-hidden" role="status">{loadingLabel}</p>}
  {showEmpty && <div className="ui-table-empty" role="status"><p style={{ margin: 0 }}>{emptyMessage}</p>{emptyAction && <div style={{ marginTop: "var(--space-3)" }}>{emptyAction}</div>}</div>}</div>;
}
