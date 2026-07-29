/**
 * Shared design tokens.
 *
 * Before this file existed, every page hardcoded its own font sizes,
 * weights, and border radii as raw numbers (fontSize: 13, fontSize: 13.5,
 * fontSize: 14 all meaning "small body text" in different files). That
 * made the app look slightly different from screen to screen and made
 * changing anything app-wide impossible.
 *
 * Import `theme` wherever you'd otherwise write a magic number:
 *
 *   import { theme } from "../../styles/theme";
 *   const styles = {
 *     label: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.medium },
 *   };
 *
 * Changing a value here updates every page that uses that token.
 */

export const fontFamily = {
    base: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, Consolas, monospace",
};

/**
 * Type scale. Use the smallest token that fits the job — don't reach for
 * a raw number. If nothing fits, that's a sign the scale needs a new
 * step, not an excuse to inline a value.
 */
export const fontSize = {
    badge: 9, // tiny counters / dots (e.g. notification badge)
    xxs: 10, // micro labels, mobile avatar initials
    xs: 11, // table meta text, helper text
    sm: 12, // secondary/body-small text, compact table cells
    base: 13, // default body text, form inputs, buttons
    md: 14, // emphasized body text, nav labels
    lg: 15, // subheadings, larger buttons
    xl: 16, // small section titles
    "2xl": 18, // section titles
    "3xl": 20, // card/page sub-headers
    "4xl": 22, // page headers (compact/mobile)
    "5xl": 24, // page headers
    "6xl": 26, // large page headers (auth screens)
    "7xl": 32, // hero numbers / stat highlights
} as const;

export const fontWeight = {
    regular: 500,
    medium: 600,
    semibold: 700,
    bold: 800,
} as const;

/** Corner radius scale. */
export const radius = {
    xs: 6,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    "2xl": 24,
    pill: 999,
    circle: "50%",
} as const;

/** 4px-based spacing scale, for padding/margin/gap. */
export const spacing = {
    1: 4,
    2: 8,
    3: 10,
    4: 12,
    5: 14,
    6: 16,
    7: 20,
    8: 24,
    9: 28,
    10: 32,
    12: 40,
    16: 56,
} as const;

export const theme = { fontFamily, fontSize, fontWeight, radius, spacing };
export default theme;
