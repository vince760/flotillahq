/**
 * Property identity = colour x marker shape.
 *
 * A map is an "all-pairs" form: any two markers can end up side by side, so the
 * palette has to hold up across every pair, not just neighbours in a legend.
 * Validated with the data-viz palette checker, only the first four hues clear
 * that bar together (worst all-pairs CVD dE 9.2 light / 6.9 dark).
 *
 * Even so, no two properties share a colour: a repeated hue reads as "same
 * project" no matter what shape it wears. Hues 5-8 are ordered to stay as far
 * from the first four as possible for normal vision, and from the fifth
 * property on the shape changes too, so colour-blind readers keep a second
 * channel where those later hues sit close to an earlier one.
 */

export const SERIES_HEX = {
  light: ["#2a78d6", "#eda100", "#e87ba4", "#008300", "#1baf7a", "#eb6834", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#c98500", "#d55181", "#008300", "#199e70", "#d95926", "#9085e9", "#e66767"],
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

/**
 * Driven by the server-assigned slot, which is the property's rank among the
 * user's properties in first-seen order - never by position in a filtered list,
 * so hiding a property never repaints the others.
 *
 * Colour cycles every eight, shape every four: slots 0-7 all get distinct
 * colours, and (colour, shape) stays unique through slot 15.
 */
export function identityFor(slot: number): Identity {
  const s = Math.abs(slot);
  const colorIndex = s % COLOR_COUNT;
  const shapeIndex = Math.floor(s / 4) % SHAPES.length;
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
