/**
 * An image card's colours, as the note shows them now: the page colour (the
 * theme's, or the writer's own background), the text, the secondary text and
 * the rule. Read from the rendered note panel, so a background colour and its
 * ink carry over, and flattened to solid `#rrggbb` (the card renderer accepts
 * nothing else).
 */

import { inkFor } from "../theme/noteBackground";

export interface CardColors {
  background: string;
  ink: string;
  muted: string;
  rule: string;
}

type Rgba = [number, number, number, number];

/** `rgb(…)` / `rgba(…)` / `color(srgb …)` as channels 0–255 and alpha 0–1. */
export function parseCssColor(value: string): Rgba | null {
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value.trim());
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value.trim());
  if (srgb) {
    const alpha = srgb[4] === undefined ? 1 : srgb[4].endsWith("%") ? parseFloat(srgb[4]) / 100 : parseFloat(srgb[4]);
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, alpha];
  }
  return null;
}

function hex(channels: readonly number[]): string {
  return `#${channels.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`;
}

/** A colour laid over `under` and flattened to solid `#rrggbb`. */
export function flatten(color: Rgba, under: Rgba): string {
  const [r, g, b, a] = color;
  return hex([r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)]);
}

const WHITE: Rgba = [255, 255, 255, 1];

/** Resolve each colour token by letting the browser compute it inside `panel`. */
export function cardColorsFrom(panel: Element): CardColors {
  const probe = document.createElement("span");
  probe.style.display = "none";
  panel.appendChild(probe);
  const resolve = (token: string): Rgba | null => {
    probe.style.color = `var(${token})`;
    return parseCssColor(getComputedStyle(probe).color);
  };
  const page = resolve("--color-bg-app") ?? WHITE;
  const solidPage: Rgba = [page[0], page[1], page[2], 1];
  const over = (token: string, fallback: string) => {
    const color = resolve(token);
    return color ? flatten(color, solidPage) : fallback;
  };
  const colors = {
    background: flatten(page, WHITE),
    ink: over("--color-doc-text", "#1f1d1a"),
    muted: over("--color-text-secondary", "#55514a"),
    rule: over("--color-rule", "#1f1d1a"),
  };
  probe.remove();
  return colors;
}

/** The ink for a card on a colour of the writer's choosing, by its lightness. */
export function cardColorsOn(background: string): CardColors {
  return inkFor(background) === "dark"
    ? { background, ink: "#1f1d1a", muted: "#4a463f", rule: "#1f1d1a" }
    : { background, ink: "#f2efea", muted: "#c9c3b8", rule: "#f2efea" };
}
