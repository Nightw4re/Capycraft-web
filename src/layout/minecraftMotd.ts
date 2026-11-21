import type { CSSProperties } from 'react';
import { minecraftFormattingCode } from '../minecraftText.mts';

export { plainMinecraftText } from '../minecraftText.mts';

const legacyColors: Record<string, string> = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa',
  '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa',
  '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

type MotdStyle = {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
};

type MotdPart = { start: number; text: string; style: CSSProperties };

const decorations: Record<string, keyof Omit<MotdStyle, 'color'>> = {
  l: 'bold',
  m: 'strikethrough',
  n: 'underline',
  o: 'italic',
};

function luminance([red, green, blue]: number[]) {
  const linear = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

// Upper bound for the raised panel background, even with white dye in theme.css.
const minimumLuminance = 4.5 * (luminance([64, 64, 68]) + 0.05) - 0.05;

function readableColor(hex: string) {
  const rgb = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
  if (luminance(rgb) >= minimumLuminance) return hex;

  const lighten = (step: number) => rgb.map(channel => Math.round(channel + (255 - channel) * step / 255));
  let low = 0;
  let high = 255;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (luminance(lighten(middle)) >= minimumLuminance) high = middle;
    else low = middle;
  }
  return '#' + lighten(high).map(channel => channel.toString(16).padStart(2, '0')).join('');
}

export function parseMinecraftMotd(motd: string): MotdPart[] {
  const parts: MotdPart[] = [];
  let start = 0;
  let style: MotdStyle = {};

  const append = (end: number) => {
    if (start === end) return;
    const lines = [style.underline && 'underline', style.strikethrough && 'line-through'].filter(Boolean);
    parts.push({
      start,
      text: motd.slice(start, end),
      style: {
        color: style.color,
        fontWeight: style.bold ? 600 : undefined,
        fontStyle: style.italic ? 'italic' : undefined,
        textDecorationLine: lines.length ? lines.join(' ') : undefined,
      },
    });
  };

  for (const match of motd.matchAll(minecraftFormattingCode)) {
    append(match.index);
    start = match.index + match[0].length;
    const code = match[1].toLowerCase();
    const color = code.startsWith('#') ? code : code.startsWith('x')
      ? '#' + code.slice(1).replaceAll('\u00a7', '') : legacyColors[code];
    if (color) style = { color: readableColor(color) };
    else if (code === 'r') style = {};
    else if (decorations[code]) style[decorations[code]] = true;
  }
  append(motd.length);
  return parts;
}
