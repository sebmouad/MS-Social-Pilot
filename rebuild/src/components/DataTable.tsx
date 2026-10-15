import type { ReactNode } from "react";

export type TableColumn<T> = { key: string; label: string; render: (row: T) => ReactNode; align?: "start" | "end"; sortable?: boolean };
type DataTableProps<T> = { columns: TableColumn<T>[]; rows: T[]; rowKey: (row: T) => string; caption: string; emptyMessage?: string; sort?: { key: string; direction: "ascending" | "descending"; onChange: (key: string) => void } };

export function DataTable<T>({ columns, rows, rowKey, caption, emptyMessage = "Nothing to show yet.", sort }: DataTableProps<T>) {
  return <div className="ui-table-shell"><div className={`ui-table-wrap${rows.length ? '' : ' is-empty'}`} role="region" aria-label={caption} tabIndex={0}>
    <table className="ui-table"><caption className="ui-visually-hidden">{caption}</caption>
      <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className={column.align === "end" ? "is-end" : ""} aria-sort={column.sortable && sort ? sort.key === column.key ? sort.direction : "none" : undefined}>
        {column.sortable && sort ? <button type="button" className="ui-table__sort" onClick={() => sort.onChange(column.key)}>{column.label}<span aria-hidden="true">{sort.key === column.key ? sort.direction === "ascending" ? " ↑" : " ↓" : " ↕"}</span></button> : column.label}
      </th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.key} className={column.align === "end" ? "is-end" : ""}>{column.render(row)}</td>)}</tr>)}</tbody>
    </table>
  </div>{!rows.length && <p className="ui-table-empty" role="status">{emptyMessage}</p>}</div>;
}
