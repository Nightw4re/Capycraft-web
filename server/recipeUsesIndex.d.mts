export type RecipeUsesIndex = {
  recipes: { id?: string }[];
  ingredients: Record<string, number[]>;
};
export const recipeUsesIndexFile: string;
export function createRecipeUsesIndex(): RecipeUsesIndex;
export function addRecipeUses(index: RecipeUsesIndex, recipes: unknown[]): void;
