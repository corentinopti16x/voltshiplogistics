import type { FinanceWeek } from "@/lib/finance/weeks";

/**
 * Weekly result as an inline SVG bar chart (no chart library). Positive weeks in green,
 * negative in rust, estimated weeks hatched. Admin pages only.
 */
export function WeeklyResultChart({
  weeks,
  locale,
  title,
  selected,
}: {
  weeks: FinanceWeek[];
  locale: string;
  title: string;
  selected?: string;
}) {
  const width = 720;
  const height = 220;
  const padTop = 18;
  const padBottom = 34;
  const padLeft = 56;
  const padRight = 12;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const values = weeks.map((week) => week.result);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const scaleY = (value: number) => padTop + ((max - value) / span) * plotH;
  const zeroY = scaleY(0);
  const slot = plotW / Math.max(1, weeks.length);
  const barW = Math.max(8, slot * 0.6);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const ticks = [max, max / 2, 0, min / 2, min].filter((value, index, array) => array.indexOf(value) === index);
  const describe = weeks.map((week) => `S${week.isoWeek}: ${money.format(week.result)}`).join(", ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${title}. ${describe}`}
      className="h-auto w-full"
      style={{ maxHeight: 260 }}
    >
      <title>{title}</title>
      <defs>
        <pattern id="finance-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" />
        </pattern>
      </defs>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={scaleY(tick)}
            y2={scaleY(tick)}
            stroke="var(--line)"
            strokeDasharray={tick === 0 ? undefined : "2 4"}
          />
          <text
            x={padLeft - 8}
            y={scaleY(tick) + 4}
            textAnchor="end"
            fontSize="10"
            fill="var(--muted)"
            className="tabular"
          >
            {compact.format(tick)}
          </text>
        </g>
      ))}
      {weeks.map((week, index) => {
        const x = padLeft + index * slot + (slot - barW) / 2;
        const y = week.result >= 0 ? scaleY(week.result) : zeroY;
        const h = Math.max(1, Math.abs(scaleY(week.result) - zeroY));
        const colour = week.result >= 0 ? "var(--green-ink)" : "var(--rust-ink)";
        const isSelected = selected === week.weekStart;
        return (
          <g key={week.weekStart} style={{ color: colour }}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={3}
              fill={colour}
              fillOpacity={week.estimated ? 0.35 : isSelected ? 1 : 0.85}
              stroke={isSelected ? "var(--ink)" : "none"}
              strokeWidth={isSelected ? 1.5 : 0}
            />
            {week.estimated ? <rect x={x} y={y} width={barW} height={h} rx={3} fill="url(#finance-hatch)" opacity={0.5} /> : null}
            <text
              x={x + barW / 2}
              y={height - padBottom + 14}
              textAnchor="middle"
              fontSize="10"
              fill={isSelected ? "var(--ink)" : "var(--muted)"}
              fontWeight={isSelected ? 700 : 400}
            >
              S{week.isoWeek}
            </text>
            <text x={x + barW / 2} y={height - padBottom + 26} textAnchor="middle" fontSize="9" fill="var(--faint)">
              {week.weekStart.slice(8, 10)}/{week.weekStart.slice(5, 7)}
            </text>
            <title>
              S{week.isoWeek} · {money.format(week.result)}
              {week.estimated ? " (est.)" : ""}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
