/**
 * Property identity = colour x marker shape.
 *
 * A map is an "all-pairs" form: any two markers can end up side by side, so the
 * palette has to hold up across every pair, not just neighbours in a legend.
 * Validated with the data-viz palette checker, only four of the eight documented
 * hues clear that bar together (worst all-pairs CVD dE 9.2 light / 6.9 dark), so
 * colour alone tops out at four properties.
 *
 * Shape is therefore a permanent second channel rather than an overflow hatch:
 * it carries identity where colour cannot, and it is what makes the dark-mode
 * pair in the 6-8 warn band legitimate. Four colours x four shapes distinguishes
 * sixteen properties without ever inventing a ninth hue.
 */

export const SERIES_HEX = {
  light: ["#2a78d6", "#eda100", "#e87ba4", "#008300"],
  dark: ["#3987e5", "#c98500", "#d55181", "#008300"],
} as const;

export const SHAPES = ["circle", "square", "triangle", "diamond"] as const;
export type Shape = (typeof SHAPES)[number];

export const COLOR_COUNT = SERIES_HEX.light.length;

export type Identity = {
  /** CSS variable, so light/dark swap in one place. */
  color: string;
  colorIndex: number;
  shape: Shape;
};

/** Stable: driven by the server-assigned slot, never by position in a list. */
export function identityFor(slot: number): Identity {
  const colorIndex = ((slot % COLOR_COUNT) + COLOR_COUNT) % COLOR_COUNT;
  const shapeIndex = Math.floor(Math.abs(slot) / COLOR_COUNT) % SHAPES.length;
  return {
    color: "var(--series-" + (colorIndex + 1) + ")",
    colorIndex,
    shape: SHAPES[shapeIndex],
  };
}

/**
 * Path for a marker of the given shape, centred on the origin. Sizes are tuned
 * so the four shapes read as the same visual weight at the same `r`.
 */
export function shapePath(shape: Shape, r: number): string {
  switch (shape) {
    case "square": {
      const a = r * 0.88;
      return "M" + -a + "," + -a + "h" + a * 2 + "v" + a * 2 + "h" + -a * 2 + "Z";
    }
    case "triangle": {
      const a = r * 1.24;
      const top = -a;
      const bottom = a * 0.72;
      return "M0," + top + "L" + a * 0.92 + "," + bottom + "L" + -a * 0.92 + "," + bottom + "Z";
    }
    case "diamond": {
      const a = r * 1.22;
      return "M0," + -a + "L" + a + ",0L0," + a + "L" + -a + ",0Z";
    }
    case "circle":
    default: {
      // An arc pair keeps every shape on the same <path> element.
      return (
        "M" + -r + ",0a" + r + "," + r + " 0 1,0 " + r * 2 + ",0a" + r + "," + r + " 0 1,0 " + -r * 2 + ",0Z"
      );
    }
  }
}

export const SHAPE_LABEL: Record<Shape, string> = {
  circle: "circle",
  square: "square",
  triangle: "triangle",
  diamond: "diamond",
};
