export const minecraftFormattingCode = /\u00a7(x(?:\u00a7[0-9a-f]){6}|#[0-9a-f]{6}|[0-9a-fk-or])/gi;

export function plainMinecraftText(text: string) {
  return text.replace(minecraftFormattingCode, '');
}
