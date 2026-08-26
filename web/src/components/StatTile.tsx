import { delta as computeDelta, type Delta } from "../lib/format";

type Props = {
  label: string;
  value: string;
  /** Full-precision value for the title attribute, when the display is compact. */
  exact?: string;
  current?: number;
  previous?: number;
  comparison?: string;
  /** Down is good for some measures (e.g. bounce rate). */
  invertDelta?: boolean;
};

export function StatTile({
  label,
  value,
  exact,
  current,
  previous,
  comparison = "previous period",
  invertDelta = false,
}: Props) {
  const change: Delta | null =
    current !== undefined && previous !== undefined ? computeDelta(current, previous) : null;

  const tone =
    change === null || change.direction === "flat"
      ? "flat"
      : (change.direction === "up") !== invertDelta
        ? "up"
        : "down";

  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value" title={exact}>
        {value}
      </div>
      {change ? (
        <div className={"delta " + tone}>
          <span className="arrow" aria-hidden="true">
            {change.direction === "up" ? "▲" : change.direction === "down" ? "▼" : "■"}
          </span>
          <span>{change.text}</span>
          <span className="vs">vs {comparison}</span>
        </div>
      ) : (
        <div className="delta">
          <span className="vs">no prior data</span>
        </div>
      )}
    </div>
  );
}
