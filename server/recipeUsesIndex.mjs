export const recipeUsesIndexFile = 'recipe-uses-v1.json';

const itemId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export function createRecipeUsesIndex() {
  return { recipes: [], ingredients: Object.create(null) };
}

export function addRecipeUses(index, recipes) {
  for (const recipe of recipes) {
    if (recipe?.status !== 'supported' || !Array.isArray(recipe.inputs)) continue;
    const ingredients = new Set(recipe.inputs.flatMap(input => Array.isArray(input?.exampleItems)
      ? input.exampleItems.filter(id => typeof id === 'string' && itemId.test(id)) : []));
    if (!ingredients.size) continue;
    const position = index.recipes.push(recipe) - 1;
    for (const id of ingredients) (index.ingredients[id] ??= []).push(position);
  }
}
