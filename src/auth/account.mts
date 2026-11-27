export const accountPath = '/api/account';

export type MinecraftLink = { server: string; uuid: string; name: string };
export type Account = { servers: string[]; links: MinecraftLink[] };
export const linkCodePattern = /^[A-Za-z0-9_-]{16}$/;
