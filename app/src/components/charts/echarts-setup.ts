import * as echarts from "echarts/core";
import { BarChart, FunnelChart, HeatmapChart, LineChart, PieChart } from "echarts/charts";
import { AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { LegacyGridContainLabel } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";

// Only what the shared charts use is registered, and this module is loaded lazily
// (dynamic import) so ECharts stays out of pages that render no chart.
echarts.use([BarChart, FunnelChart, HeatmapChart, LineChart, PieChart, AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, LegacyGridContainLabel, CanvasRenderer]);

export const init = echarts.init;
