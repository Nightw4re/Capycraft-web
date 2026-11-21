import sharp from 'sharp';

export async function downloadMinecraftSkin(
  name: string,
  request: (url: string) => Promise<Response> = url => fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(5000),
  }),
) {
  const profile = await request(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
  if (!profile.ok || profile.status === 204) {
    await profile.body?.cancel();
    throw new Error(`Minecraft profile lookup failed for ${name} (${profile.status})`);
  }
  const { id } = await profile.json() as { id?: string };
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/i.test(id)) throw new Error(`Invalid Minecraft profile for ${name}`);

  const session = await request(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
  if (!session.ok || session.status === 204) {
    await session.body?.cancel();
    throw new Error(`Minecraft session lookup failed for ${name} (${session.status})`);
  }
  const { properties } = await session.json() as { properties?: { name: string; value: string }[] };
  const texture = properties?.find(property => property.name === 'textures')?.value;
  if (!texture) throw new Error(`Minecraft did not return skin information for ${name}`);
  const { textures } = JSON.parse(Buffer.from(texture, 'base64').toString('utf8')) as {
    textures?: { SKIN?: { url: string; metadata?: { model?: string } } };
  };
  const skin = textures?.SKIN;
  const hash = skin?.url.match(/^https?:\/\/textures\.minecraft\.net\/texture\/([a-f0-9]{32,64})$/i)?.[1];
  if (!hash) throw new Error(`No custom Java skin found for ${name}`);

  const image = await request(`https://textures.minecraft.net/texture/${hash}`);
  if (!image.ok) {
    await image.body?.cancel();
    throw new Error(`Could not download the Minecraft skin for ${name} (${image.status})`);
  }
  const bytes = Buffer.from(await image.arrayBuffer());
  const { format, width, height } = await sharp(bytes).metadata();
  if (format !== 'png' || width !== 64 || (height !== 32 && height !== 64)) throw new Error(`Invalid Java skin for ${name}`);

  const model = skin?.metadata?.model === 'slim' ? 'slim' as const : 'classic' as const;
  return { bytes, hash, model };
}
