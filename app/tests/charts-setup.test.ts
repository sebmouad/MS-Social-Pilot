import { use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { describe, expect, it } from 'vitest';
import { buildBarModel } from '../src/components/charts/BarChart';
import { buildDonutModel } from '../src/components/charts/DonutChart';
import { buildFunnelModel } from '../src/components/charts/FunnelChart';
import { buildHeatmapModel } from '../src/components/charts/HeatmapChart';
import { buildPyramidModel } from '../src/components/charts/AudiencePyramid';
import { buildTimeSeriesModel } from '../src/components/charts/TimeSeriesChart';
import type { ChartEnv } from '../src/components/charts/theme';

const env: ChartEnv = { reducedMotion: true, theme: { palette: ['#336699', '#996633'], grid: '#dddddd', text: '#333333', surface: '#ffffff', accent: '#cc3300', ink: '#111111', inkSoft: '#555555', line: '#cccccc' } };

// Renders every option through the real tree-shaken ECharts registration (SVG, server-side),
// proving that all components and series types used by the options are registered.
describe('echarts registration', () => {
  it('renders every chart option with the registered components', async () => {
    const { init } = await import('../src/components/charts/echarts-setup');
    // The app registers only the canvas renderer; SVG is added here solely to render server-side.
    use([SVGRenderer]);
    const models = [
      buildTimeSeriesModel({ label: 'x', series: [{ id: 'a', name: 'A', points: [{ t: '2026-10-01', v: 1 }, { t: '2026-10-02', v: 3 }], comparison: [{ t: '2026-09-01', v: 2 }, { t: '2026-09-02', v: 2 }] }] }),
      buildBarModel({ label: 'x', categories: ['A', 'B'], series: [{ id: 's', name: 'S', values: [1, 2] }], orientation: 'horizontal' }),
      buildDonutModel({ label: 'x', slices: [{ name: 'A', value: 1 }, { name: 'B', value: 2 }] }),
      buildHeatmapModel({ label: 'x', cells: [{ day: 1, hour: 9, value: 2 }, { day: 2, hour: 10, value: 5 }] }),
      buildFunnelModel({ label: 'x', stages: [{ name: 'A', value: 10 }, { name: 'B', value: 4 }] }),
      buildPyramidModel({ label: 'x', groups: ['18-24'], left: { name: 'L', values: [2] }, right: { name: 'R', values: [3] } }),
    ];
    for (const model of models) {
      const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 400, height: 240 });
      chart.setOption(model.option(env) as never);
      expect(chart.renderToSVGString()).toContain('<svg');
      chart.dispose();
    }
  });
});
