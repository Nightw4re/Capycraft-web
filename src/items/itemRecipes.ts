import { isItemId, type ItemRecipe } from './catalogData';

export const recipeStations = [
  'minecraft:crafting_table', 'minecraft:furnace', 'minecraft:blast_furnace', 'minecraft:smoker',
  'minecraft:campfire', 'minecraft:stonecutter', 'minecraft:smithing_table',
] as const;

export type RecipeIngredient = { items: string[]; tags: string[]; custom: boolean; truncated: boolean };

export type MachineIngredient = { id: string; kind: 'item' | 'fluid'; amount: number };
type RecipeBounds = { x: number; y: number; width: number; height: number };
export type MachineRecipeSlot = {
  role: 'input' | 'output' | 'catalyst';
  bounds?: RecipeBounds;
  name?: string;
  alternatives: MachineIngredient[];
  otherIngredients: boolean;
  alternativesTruncated: boolean;
};
export type MachineRecipe = {
  category: string;
  title: string;
  frame: RecipeBounds;
  slots: MachineRecipeSlot[];
};

export type RecipeEntry = {
  id: string;
  station: string;
  type?: string;
  machine?: MachineRecipe;
  instructions?: {
    columns: number;
    inputs: (RecipeIngredient | null)[];
    result: { id: string; count: number };
  };
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function itemIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(isItemId))] : [];
}

function readIngredient(value: unknown): RecipeIngredient | null {
  if (value === null) return null;
  const { exampleItems, tags, match, examplesTruncated } = record(value);
  return { items: itemIds(exampleItems), tags: itemIds(tags), custom: match === 'custom', truncated: examplesTruncated === true };
}

function withCraftingGrid(station: string, instructions: NonNullable<RecipeEntry['instructions']>) {
  const { columns, inputs } = instructions;
  const gridSize = 3;
  if (station !== 'minecraft:crafting_table' || columns > gridSize || inputs.length > columns * gridSize) {
    return instructions;
  }

  return {
    ...instructions,
    columns: gridSize,
    inputs: Array.from({ length: gridSize ** 2 }, (_, index) => {
      const column = index % gridSize;
      const row = Math.floor(index / gridSize);
      return column < columns ? inputs[row * columns + column] ?? null : null;
    }),
  };
}

function dimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 4096;
}

function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 4096;
}

function readMachineSlot(value: unknown): MachineRecipeSlot[] {
  const { role, bounds, name, alternatives, otherIngredients, alternativesTruncated } = record(value);
  if ((role !== 'input' && role !== 'output' && role !== 'catalyst') || !Array.isArray(alternatives)) return [];
  const { x, y, width, height } = record(bounds);
  return [{
    role,
    bounds: coordinate(x) && coordinate(y) && dimension(width) && dimension(height) ? { x, y, width, height } : undefined,
    name: typeof name === 'string' && name.trim() ? name : undefined,
    alternatives: alternatives.flatMap((value): MachineIngredient[] => {
      const { id, kind, count, amountMb } = record(value);
      const amount = kind === 'item' ? count : amountMb;
      return (kind === 'item' || kind === 'fluid') && isItemId(id)
        && typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 ? [{ id, kind, amount }] : [];
    }),
    otherIngredients: otherIngredients === true,
    alternativesTruncated: alternativesTruncated === true,
  }];
}

function readMachineRecipes(value: unknown) {
  const { itemId, fluidId, recipes } = record(value);
  const resultKind = isItemId(fluidId) ? 'fluid' : 'item';
  const resultId = fluidId ?? itemId;
  const rendered = new Set<string>();
  const entries: RecipeEntry[] = [];
  if (!isItemId(resultId) || !Array.isArray(recipes)) return { entries, rendered };
  for (const value of recipes) {
    const { id, category, title, stations, layout } = record(value);
    const { width, height, slots: rawSlots } = record(layout);
    if (!isItemId(id) || !isItemId(category) || typeof title !== 'string' || !title.trim()
      || !dimension(width) || !dimension(height) || !Array.isArray(rawSlots)) continue;
    const slots = rawSlots.flatMap(readMachineSlot);
    if (!slots.some(slot => slot.role === 'output'
      && slot.alternatives.some(ingredient => ingredient.kind === resultKind && ingredient.id === resultId))) continue;
    let left = 0;
    let top = 0;
    let right = width;
    let bottom = height;
    for (const { bounds } of slots) {
      if (!bounds) continue;
      left = Math.min(left, bounds.x);
      top = Math.min(top, bounds.y);
      right = Math.max(right, bounds.x + bounds.width);
      bottom = Math.max(bottom, bounds.y + bounds.height);
    }
    const machine = { category, title, slots, frame: { x: left, y: top, width: right - left, height: bottom - top } };
    const stationIds = itemIds(stations);
    for (const station of stationIds.length ? stationIds : [category]) entries.push({ id, station, machine });
    rendered.add(id);
  }
  return { entries, rendered };
}

export function readRecipeFeed(value: unknown): RecipeEntry[] {
  const { itemId, recipes, machineRecipes } = record(value);
  const { entries, rendered } = readMachineRecipes(machineRecipes);
  const world = Array.isArray(recipes) ? recipes : [];
  const infusion = 'mysticalagriculture:infusion';
  function infusionOutput(value: unknown) {
    const { type, result, reportedResult } = record(value);
    const output = record(result ?? reportedResult);
    return type === infusion && output.itemId === itemId ? output.count : undefined;
  }

  const visible = world.filter(value => {
    const { id, status } = record(value);
    if (status !== 'unsupported') return true;
    if (typeof id === 'string' && rendered.has(id)) return false;

    // JEI may give the infusion layout a generated ID. Only pair a unique world recipe and display.
    const count = infusionOutput(value);
    if (typeof count !== 'number' || !isItemId(itemId) || record(machineRecipes).itemId !== itemId
      || world.filter(recipe => infusionOutput(recipe) === count).length !== 1) return true;

    const displays = new Set(entries.filter(({ machine }) => machine?.category === infusion
      && machine.slots.some(slot => slot.role === 'output' && slot.alternatives.some(ingredient =>
        ingredient.kind === 'item' && ingredient.id === itemId && ingredient.amount === count)))
      .map(({ id }) => id));
    const [display] = displays;
    return displays.size !== 1 || !display.startsWith(`${infusion}/display/`)
      || !entries.find(entry => entry.id === display)?.machine?.slots.some(slot =>
        slot.role === 'input' && slot.alternatives.length > 0);
  });
  return [...visible.map((value, index) => {
    const { id, station, type, status, layout, inputs, result } = record(value);
    const entry: RecipeEntry = {
      id: isItemId(id) ? id : `@${index}`,
      station: typeof station === 'string' ? station : '',
      type: typeof type === 'string' ? type : undefined,
    };
    const { itemId, count } = record(result);
    if (status !== 'supported' || !Array.isArray(inputs) || !inputs.some(input => input !== null)
      || !isItemId(itemId) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) return entry;

    const { kind, width, height } = record(layout);
    const columns = kind === 'grid' ? width : Math.min(3, inputs.length);
    if (typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1 || columns > 9
      || (kind === 'grid' && (typeof height !== 'number' || !Number.isInteger(height) || height < 1
        || height * columns !== inputs.length))) return entry;

    entry.instructions = withCraftingGrid(entry.station, {
      columns,
      inputs: inputs.map(readIngredient),
      result: { id: itemId, count },
    });
    return entry;
  }), ...entries];
}

export function readLegacyRecipes(recipes: ItemRecipe[], resultId: string): RecipeEntry[] {
  return recipes.map(({ station, columns, ingredients, outputCount }, index) => ({
    id: `@${index}`,
    station,
    instructions: withCraftingGrid(station, {
      columns,
      inputs: ingredients.map(id => id === null ? null : { items: [id], tags: [], custom: false, truncated: false }),
      result: { id: resultId, count: outputCount },
    }),
  }));
}
