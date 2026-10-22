"use client";
import type { EChartsCoreOption } from "echarts/core";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EmptyState } from "../EmptyState";
import { Skeleton } from "../Skeleton";
import "./charts.css";
import { UNKNOWN } from "./format";
import { getMessages } from "./messages";
import type { ChartEnv } from "./theme";
import { useChartEnv } from "./theme";

export type ChartOption = EChartsCoreOption;

/** Formatted cells for the screen-reader / copy-paste table. `null` renders as unknown. */
export type ChartTable = { columns: string[]; rows: Array<Array<string | null>> };

/** What each chart builds from its props; the shell turns it into a themed ECharts option. */
export type ChartModel = {
  table: ChartTable;
  /** True when there is nothing plottable. */
  empty: boolean;
  /** Number of points reachable with the keyboard (arrow keys show the tooltip). */
  focusCount: number;
  /** Changes whenever a non-serializable input (formatters, locale) changes. */
  signature: string;
  option: (env: ChartEnv) => ChartOption;
};

export type ChartBaseProps = {
  /** Summary read by assistive technology (role="img" label). */
  label: string;
  /** BCP 47 locale for numbers, dates and default copy. */
  locale?: string;
  height?: number | string;
  /** Visually hidden data table fallback. Default on. */
  table?: boolean;
  tableCaption?: string;
  loading?: boolean;
  /** Truthy shows the error state; a string is shown as the explanation. */
  error?: ReactNode;
  /** Overrides the automatic "no plottable data" detection. */
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
};

type CanvasProps = { option: ChartOption | null; signature: string; label: string; height: number | string; focusCount: number };

type ChartInstance = {
  setOption: (option: ChartOption, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
  dispatchAction: (action: Record<string, unknown>) => void;
};

function ChartCanvas({ option, signature, label, height, focusCount }: CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartInstance | null>(null);
  const applied = useRef("");
  const latest = useRef({ option, signature });
  latest.current = { option, signature };
  const focused = useRef(-1);

  const apply = () => {
    const current = latest.current;
    if (!chart.current || !current.option) return;
    const key = current.signature + JSON.stringify(current.option);
    if (key === applied.current) return;
    applied.current = key;
    chart.current.setOption(current.option, true);
  };

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    import("./echarts-setup").then(({ init }) => {
      if (disposed || !host.current) return;
      const instance = init(host.current, undefined, { renderer: "canvas" }) as unknown as ChartInstance;
      chart.current = instance;
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => instance.resize());
        observer.observe(host.current);
      }
      apply();
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
      applied.current = "";
    };
  }, []);

  useEffect(apply, [option, signature]);

  const showTip = (index: number) => {
    focused.current = index;
    chart.current?.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: index });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (focusCount <= 0) return;
    const last = focusCount - 1;
    const keys: Record<string, number> = {
      ArrowRight: Math.min(last, focused.current + 1), ArrowDown: Math.min(last, focused.current + 1),
      ArrowLeft: Math.max(0, focused.current - 1), ArrowUp: Math.max(0, focused.current - 1),
      Home: 0, End: last,
    };
    if (event.key === "Escape") { chart.current?.dispatchAction({ type: "hideTip" }); focused.current = -1; return; }
    if (!(event.key in keys)) return;
    event.preventDefault();
    showTip(keys[event.key]!);
  };

  return <div
    ref={host}
    role="img"
    aria-label={label}
    tabIndex={focusCount > 0 ? 0 : undefined}
    onKeyDown={onKeyDown}
    onFocus={focusCount > 0 ? () => showTip(Math.max(0, focused.current)) : undefined}
    onBlur={focusCount > 0 ? () => { chart.current?.dispatchAction({ type: "hideTip" }); focused.current = -1; } : undefined}
    style={{ width: "100%", height }}
  />;
}

function DataTable({ table, caption, visible = false }: { table: ChartTable; caption: string; visible?: boolean }) {
  return <table className={visible ? "ui-chart__table" : "ui-visually-hidden"}>
    <caption>{caption}</caption>
    <thead><tr>{table.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
    <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>
      {row.map((cell, index) => index === 0 ? <th key={index} scope="row">{cell ?? UNKNOWN}</th> : <td key={index}>{cell ?? UNKNOWN}</td>)}
    </tr>)}</tbody>
  </table>;
}

export function ChartShell({ model, height = 280, ...props }: ChartBaseProps & { model: ChartModel }) {
  const env = useChartEnv();
  const [dataShown, setDataShown] = useState(false);
  const messages = getMessages(props.locale ?? "en");
  const className = ["ui-chart", props.className].filter(Boolean).join(" ");
  const box = { minHeight: typeof height === "number" ? height : undefined };

  if (props.error) {
    return <div className={className} style={box}><EmptyState tone="error" title={messages.errorTitle}>{typeof props.error === "string" ? props.error : undefined}</EmptyState></div>;
  }
  if (props.loading) {
    return <div className={className} style={box}><Skeleton lines={4} label={messages.loading} /></div>;
  }
  if (props.empty ?? model.empty) {
    return <div className={className} style={box}><EmptyState title={props.emptyTitle ?? messages.emptyTitle}>{props.emptyHint ?? messages.emptyHint}</EmptyState></div>;
  }
  return <div className={className} style={{ position: "relative", width: "100%" }}>
    <ChartCanvas option={env ? model.option(env) : null} signature={model.signature} label={props.label} height={height} focusCount={model.focusCount} />
    {(props.table ?? true) && <>
      <button type="button" className="ui-chart__toggle" aria-expanded={dataShown} onClick={() => setDataShown(value => !value)}>{dataShown ? messages.hideData : messages.showData}</button>
      <div className={dataShown ? "ui-chart__data" : undefined} tabIndex={dataShown ? 0 : undefined} role={dataShown ? "region" : undefined} aria-label={dataShown ? props.tableCaption ?? props.label : undefined}>
        <DataTable table={model.table} caption={props.tableCaption ?? props.label} visible={dataShown} />
      </div>
    </>}
  </div>;
}
