import { expect, test } from '@playwright/test';

const fluidPipe = { id: 'create:fluid_pipe', name: 'Fluid Pipe' };
const fluidTank = { id: 'create:fluid_tank', name: 'Fluid Tank' };
const smartPipe = { id: 'create:smart_fluid_pipe', name: 'Smart Fluid Pipe' };
const copperCasing = { id: 'create:copper_casing', name: 'Copper Casing' };
const stick = { id: 'minecraft:stick', name: 'Stick' };
const reactor = { id: 'mekanismgenerators:fission_reactor_casing', name: 'Fission Reactor Casing' };

test.beforeAll(async ({ request }) => {
  const response = await request.get('/api/ponder?server=atm10', { timeout: 10_000 });
  expect(response.ok(), 'ATM10 must have a published Ponder index on the running Capycraft site').toBe(true);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('capycraft.preferences')) {
      localStorage.setItem('capycraft.preferences', JSON.stringify({ language: 'en', introAnimation: false }));
    }
  });
});

async function findItem(page, item) {
  const search = new URLSearchParams({ q: item.id, lang: 'en' });
  await page.goto(`/server/atm10/items?${search}`);
  const slot = page.getByRole('list', { name: 'Items', exact: true }).getByRole('link', { name: item.name, exact: true });
  await expect(slot).toBeVisible();
  return slot;
}

const tooltip = (page, item) => page.getByRole('dialog', { name: item.name, exact: true });
const ponderAction = panel => panel.getByRole('button', { name: /^Ponder(?:\s|$)/ });
const advancedAction = panel => panel.getByRole('button', { name: /^Advanced item information/ });
const ponderDialog = page => page.getByRole('dialog', { name: /^Ponder(?:\s|$)/ });

test('mouse hover previews the colored lore, then two clicks pin the item and open recipes', async ({ page }) => {
  const slot = await findItem(page, fluidPipe);
  await slot.hover();
  const preview = page.getByRole('tooltip');
  const hint = preview.locator('.item-tooltip-lines > div').filter({ hasText: /Hold \[W\] to Ponder/ });
  await expect(hint.getByText('Hold [', { exact: true })).toHaveCSS('color', 'rgb(85, 85, 85)');
  await expect(hint.getByText('W', { exact: true })).toHaveCSS('color', 'rgb(170, 170, 170)');
  const mod = preview.getByText('Create', { exact: true });
  await expect(mod).toHaveCSS('color', 'rgb(85, 85, 255)');
  await expect(mod).toHaveCSS('font-style', 'italic');
  await expect(ponderAction(preview)).toHaveCount(0);

  const catalogUrl = page.url();
  await slot.click();
  await expect(tooltip(page, fluidPipe)).toBeVisible();
  await expect(ponderAction(tooltip(page, fluidPipe))).toBeVisible();
  await expect(page).toHaveURL(catalogUrl);
  const itemUrl = new URL(await slot.getAttribute('href') ?? '', catalogUrl);
  await slot.click();
  await expect(page).toHaveURL(url => url.pathname === itemUrl.pathname && url.pathname !== new URL(catalogUrl).pathname);
  await expect(tooltip(page, fluidPipe)).toBeHidden();
});

test('Stick has its own tooltip shortcut, and F3 + H persists across items and reloads', async ({ page }) => {
  await (await findItem(page, stick)).click();
  const panel = tooltip(page, stick);
  await expect(panel.getByText('Tool Rod', { exact: true })).toHaveCSS('color', 'rgb(127, 255, 212)');
  await expect(ponderAction(panel)).toHaveCount(0);
  await panel.getByRole('button', { name: 'Left Control', exact: true }).click();
  await expect(panel.getByText('Flexible II', { exact: true })).toBeVisible();
  await advancedAction(panel).click();
  await expect(advancedAction(panel)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByText(stick.id, { exact: true })).toBeVisible();

  const slot = await findItem(page, fluidPipe);
  await slot.click();
  await expect(advancedAction(tooltip(page, fluidPipe))).toHaveAttribute('aria-pressed', 'true');
  await expect(tooltip(page, fluidPipe).getByText(fluidPipe.id, { exact: true })).toBeVisible();
  await advancedAction(tooltip(page, fluidPipe)).click();
  await page.reload();
  await slot.click();
  await expect(advancedAction(tooltip(page, fluidPipe))).toHaveAttribute('aria-pressed', 'false');
  await expect(tooltip(page, fluidPipe).getByText(fluidPipe.id, { exact: true })).toHaveCount(0);
});

test('Fluid Pipe opens the correct animation and renders the caption at 23.7 seconds as text', async ({ page }) => {
  const pickingRequests = [];
  const isPicking = request => {
    const url = new URL(request.url());
    return url.pathname === '/api/ponder' && url.searchParams.get('path')?.includes('/picking/');
  };
  page.on('request', request => { if (isPicking(request)) pickingRequests.push(request.url()); });
  await (await findItem(page, fluidPipe)).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Ponder', exact: true })).toHaveCount(0);
  const action = ponderAction(tooltip(page, fluidPipe));
  await expect(action).toHaveAttribute('aria-keyshortcuts', 'W');
  await page.keyboard.press('w');

  const dialog = ponderDialog(page);
  const title = 'Moving Fluids using Copper Pipes';
  await expect(dialog.getByRole('combobox', { name: 'Scene' }).locator('option:checked')).toHaveText(title);
  const canvas = dialog.getByRole('img', { name: title, exact: true });
  await expect(canvas).toHaveAttribute('data-tick', /^\d+$/);
  const pause = dialog.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeVisible();
  await pause.click();

  const timeline = dialog.getByRole('slider', { name: 'Timeline' });
  await timeline.fill('474');
  await expect(canvas).toHaveAttribute('data-tick', '474');
  const caption = dialog.getByText('Once the flow connects them, the endpoints gradually transfer their contents', { exact: true });
  await expect(caption).toHaveCount(1);
  await expect(caption).toBeVisible();
  expect(pickingRequests).toHaveLength(0);
  const pickingResponse = page.waitForResponse(response => isPicking(response.request()));
  await dialog.getByText('Parts in this frame', { exact: true }).click();
  await expect(await pickingResponse).toBeOK();
  await expect(dialog.locator('.ponder-parts-list button').first()).toBeEnabled();

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await (await findItem(page, copperCasing)).click();
  await ponderAction(tooltip(page, copperCasing)).click();
  await expect(ponderDialog(page).getByRole('img', { name: 'Encasing Fluid Pipes', exact: true })).toBeVisible();
});

test('Smart Fluid Pipe opens its published animation', async ({ page }) => {
  await (await findItem(page, smartPipe)).click();
  const panel = tooltip(page, smartPipe);
  await expect(panel.locator('.item-tooltip-lines')).toContainText('Hold [W] to Ponder');
  await ponderAction(panel).click();
  const dialog = ponderDialog(page);
  await expect(dialog.getByRole('img', { name: 'Controlling Fluid flow using Smart Pipes', exact: true }))
    .toHaveAttribute('data-tick', /^\d+$/);
  await expect(dialog.getByRole('region', { name: 'Text guide' })).toHaveCount(0);
});

test('Fluid Tank follows its registration order and restores a selected scene after reload', async ({ page }) => {
  await (await findItem(page, fluidTank)).click();
  await ponderAction(tooltip(page, fluidTank)).click();
  const dialog = ponderDialog(page);
  const picker = dialog.getByRole('combobox', { name: 'Scene' });
  const first = 'Storing Fluids in Fluid Tanks';
  const second = 'Dimensions of a Fluid tank';
  await expect(picker.getByRole('option')).toHaveText([first, second]);
  await expect(picker.locator('option:checked')).toHaveText(first);
  await picker.selectOption({ label: second });
  await expect(dialog.getByRole('img', { name: second, exact: true })).toBeVisible();
  await page.reload();
  await expect(picker.locator('option:checked')).toHaveText(second);
});

test('KubeJS Fission Reactor opens its animation or the published text guide', async ({ page, request }) => {
  const response = await request.get('/api/ponder?server=atm10');
  await expect(response).toBeOK();
  const { scenes } = await response.json();
  const animated = scenes.some(scene => scene.id === 'kubejs:fission_mek' && scene.items.includes(reactor.id));
  if (process.env.CAPYCRAFT_E2E_REQUIRE_KUBEJS_ANIMATION === '1') {
    expect(animated, 'The ATM10 export should include a playable KubeJS reactor timeline').toBe(true);
  }
  await (await findItem(page, reactor)).click();
  await ponderAction(tooltip(page, reactor)).click();
  const dialog = ponderDialog(page);
  if (animated) {
    await expect(dialog.getByRole('img', { name: 'Mekanism: Fission Reactor', exact: true }))
      .toHaveAttribute('data-tick', /^\d+$/);
  } else {
    const guide = dialog.getByRole('region', { name: 'Text guide' });
    await expect(guide.getByRole('listitem').first()).toHaveText('The Edges Must Be Casings');
  }
});

test.describe('touch viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

  test('one tap pins a complete, operable tooltip at narrow widths', async ({ page }) => {
    const slot = await findItem(page, fluidPipe);
    const catalogUrl = page.url();
    await slot.tap();
    const panel = tooltip(page, fluidPipe);
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(catalogUrl);
    await expect.poll(() => panel.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      return bounds.left >= -1 && bounds.top >= -1
        && bounds.right <= (viewport?.width ?? innerWidth) + 1
        && bounds.bottom <= (viewport?.height ?? innerHeight) + 1;
    })).toBe(true);
    await ponderAction(panel).tap();
    const dialog = ponderDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(dialog).toBeHidden();
  });
});
