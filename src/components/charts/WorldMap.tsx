import WORLD from '@/lib/world-map.json';

const SHADES = ['#dbebff', '#b8d6fe', '#86b9fb', '#4e97f6', '#1877f2', '#0f57b8'];

/**
 * Where the audience lives, on a map: each country shaded by how many of the
 * Page's followers are there. Steps on a log scale, because one home country
 * usually holds most of a Page and a linear scale would leave every other
 * country the same pale blue.
 *
 * Drawn on the server from shapes prepared once (Natural Earth, 1:110m), so
 * the browser gets plain SVG and no mapping library. Each country names
 * itself and its figure on hover; the bars beside it carry the exact values
 * for anyone who cannot use the colours.
 */
export function WorldMap({
  data,
  label,
  nameOf,
  formatValue,
}: {
  /** ISO 3166-1 alpha-2 code to a count. */
  data: Record<string, number>;
  label: string;
  nameOf: (code: string) => string;
  formatValue: (value: number) => string;
}) {
  const values = Object.values(data).filter((value) => Number.isFinite(value) && value > 0);
  const max = Math.max(1, ...values);
  const shade = (value: number) => {
    const step = Math.min(SHADES.length - 1, Math.floor((Math.log(value + 1) / Math.log(max + 1)) * SHADES.length));
    return SHADES[Math.max(0, step)]!;
  };
  const paths = WORLD.paths as Record<string, string>;

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}
        role="img"
        aria-label={label}
        className="h-auto w-full"
      >
        <path d={paths._sphere} fill="#f7f8fa" stroke="#e4e6eb" strokeWidth={0.6} />
        {Object.entries(paths).map(([code, d]) => {
          if (code.startsWith('_')) return code === '_sphere' ? null : <path key={code} d={d} fill="#e4e6eb" stroke="#fff" strokeWidth={0.4} />;
          const value = data[code] ?? 0;
          return (
            <path
              key={code}
              d={d}
              fill={value > 0 ? shade(value) : '#e4e6eb'}
              stroke="#fff"
              strokeWidth={0.4}
              className={value > 0 ? 'transition-opacity hover:opacity-80' : undefined}
            >
              <title>{value > 0 ? `${nameOf(code)}: ${formatValue(value)}` : nameOf(code)}</title>
            </path>
          );
        })}
      </svg>
      <figcaption className="flex items-center justify-end gap-2 text-[11px] text-slate-500" aria-hidden>
        <span>{formatValue(Math.min(...values, max))}</span>
        <span className="flex overflow-hidden rounded-full">
          {SHADES.map((color) => (
            <span key={color} className="h-2 w-5" style={{ background: color }} />
          ))}
        </span>
        <span>{formatValue(max)}</span>
      </figcaption>
    </figure>
  );
}
