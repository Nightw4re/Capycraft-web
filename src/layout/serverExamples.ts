import logo from '../../assets/example-server-keep.webp';
import { translations, type Language } from '../preferences';
import type { MinecraftServer } from './ServerCard';

const examples = [
  {
    name: 'sampleSurvivalServer',
    motd: 'sampleSurvivalMotd',
    address: 'modded-survival.capycraft.example:25565',
    players: { current: 6, max: 24 },
    uptimeMinutes: 2 * 1440 + 8 * 60,
    worldGameTimeTicks: 38 * 24_000 + 9_600,
  },
  {
    name: 'sampleCreativeServer',
    motd: 'sampleCreativeMotd',
    address: 'creative-world.capycraft.example:25566',
    players: { current: 2, max: 16 },
    uptimeMinutes: 9 * 60 + 15,
    worldGameTimeTicks: 12 * 24_000 + 4_800,
  },
] as const;

export function serverExamples(language: Language): MinecraftServer[] {
  const text = translations[language];
  return examples.map(({ name, motd, ...server }) => ({ ...server, name: text[name], motd: text[motd], logo }));
}
