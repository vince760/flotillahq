import { useState } from "react";
import { useMeasure } from "../lib/useMeasure";
import { full } from "../lib/format";

type Props = {
  values: number[];
  labels: string[];
  color: string;
  height?: number;
  /** Names the measure in the hover readout, e.g. "users". */
  unit?: string;
  ariaLabel: string;
};

const PAD = 5;

export function Sparkline({ values, labels, color, height = 46, unit = "users", ariaLabel }: Props) {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const w = Math.max(width, 1);
  const h = height;
  const inner = { w: Math.max(w - PAD * 2, 1), h: h - PAD * 2 };
  const max = Math.max(1, ...values);

  const x = (i: number) =>
    PAD + (values.length <= 1 ? inner.w / 2 : (i / (values.length - 1)) * inner.w);
  // Counts sit on a zero baseline - anything else overstates the swing.
  const y = (v: number) => PAD + inner.h - (v / max) * inner.h;

  const line = values.map((v, i) => (i === 0 ? "M" : "L") + x(i) + "," + y(v)).join(" ");
  const area =
    values.length > 1
      ? line + " L" + x(values.length - 1) + "," + (h - PAD) + " L" + x(0) + "," + (h - PAD) + " Z"
      : "";

  const lastIndex = values.length - 1;
  const active = hover ?? null;

  function track(event: React.PointerEvent<SVGSVGElement>) {
    if (values.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - PAD) / inner.w;
    const index = Math.round(ratio * (values.length - 1));
    setHover(Math.min(values.length - 1, Math.max(0, index)));
  }

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg
        width="100%"
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block", touchAction: "none" }}
        onPointerMove={track}
        onPointerLeave={() => setHover(null)}
      >
        {values.length > 1 ? <path d={area} fill={color} opacity={0.1} /> : null}

        {active !== null ? (
          <line x1={x(active)} y1={PAD - 2} x2={x(active)} y2={h - PAD} stroke="var(--axis)" strokeWidth={1} />
        ) : null}

        {values.length > 1 ? (
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {/* End marker: >=8px across, with a 2px surface ring so it reads over the line. */}
        {values.length > 0 ? (
          <circle
            cx={x(lastIndex)}
            cy={y(values[lastIndex])}
            r={4}
            fill={color}
            stroke="var(--surface-1)"
            strokeWidth={2}
          />
        ) : null}

        {active !== null ? (
          <circle
            cx={x(active)}
            cy={y(values[active])}
            r={4}
            fill={color}
            stroke="var(--surface-1)"
            strokeWidth={2}
          />
        ) : null}
      </svg>

      {active !== null ? (
        <div
          className="tip"
          style={{
            left: Math.min(Math.max(x(active) - 60, 0), Math.max(w - 124, 0)),
            top: -6,
            transform: "translateY(-100%)",
            minWidth: 118,
          }}
        >
          <div className="row">
            <svg width={12} height={8} aria-hidden="true">
              <line x1={0} y1={4} x2={12} y2={4} stroke={color} strokeWidth={2} strokeLinecap="round" />
            </svg>
            <span className="n">{labels[active] ?? ""}</span>
            <span className="v">{full(values[active])}</span>
          </div>
          <div className="sub" style={{ paddingLeft: 19 }}>
            {unit}
          </div>
        </div>
      ) : null}
    </div>
  );
}
