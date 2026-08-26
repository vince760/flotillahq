import { shapePath, type Identity } from "../lib/palette";

type Props = { identity: Identity; size?: number; title?: string };

/**
 * The legend/table key for a property. It mirrors the map marker exactly —
 * same hue, same shape — so identity never rests on colour alone.
 */
export function Swatch({ identity, size = 14, title }: Props) {
  const r = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
      {title ? <title>{title}</title> : null}
      <g transform={`translate(${size / 2} ${size / 2})`}>
        <path d={shapePath(identity.shape, r)} fill={identity.color} />
      </g>
    </svg>
  );
}
