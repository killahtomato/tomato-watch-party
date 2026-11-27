import { test, expect } from '@playwright/test';
import { joinRoom, seedHostTokens } from './harness.mjs';

async function startFixtureMovie(page, name) {
  await seedHostTokens(page);
  await joinRoom(page, name);
  await page.click('.movie-panel-tab:not(.web-panel-tab)');
  await page.getByRole('button', { name: /clip/ }).click();
  await expect(page.locator('.video-player video')).toBeVisible();
}

async function probeIdle(page) {
  return page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'video-player empty';
    el.innerHTML = '<div class="waiting-message"><h2>Waiting</h2><p>The host will begin streaming shortly.</p></div>';
    document.body.appendChild(el);
    const message = el.querySelector('.waiting-message');
    const result = {
      backgroundImage: getComputedStyle(el).backgroundImage,
      bracket: getComputedStyle(el, '::before').content,
      label: getComputedStyle(message, '::before').content,
    };
    el.remove();
    return result;
  });
}

test('Anby Tactical pairs its accent, idle HUD, and reaction emoji', async ({ page }) => {
  await startFixtureMovie(page, 'TacticalUser');

  await page.click('.settings-panel-tab');
  await expect(page.locator('.settings-drawer')).toHaveClass(/open/);
  await page.locator('.theme-grid button[title="Anby Tactical"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'anby-tactical');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'tactical');
  await page.click('.settings-close');

  await expect(page.locator('.reaction-btn')).toHaveText(['🍔', '⚡', '🍜', '❤️']);

  await page.locator('.room-switcher .room-btn').nth(1).click();
  await expect(page.locator('.dj-room')).toBeVisible();
  await expect(page.locator('.dj-reaction-btn')).toHaveText(['🍔', '⚡', '🍜', '❤️']);

  const idleAsset = await page.request.get('/anby-idle.webp');
  expect(idleAsset.ok()).toBeTruthy();

  const idle = await probeIdle(page);
  expect(idle.backgroundImage).toContain('linear-gradient');
  expect(idle.backgroundImage).toContain('anby-idle.webp');
  expect(idle.bracket).not.toBe('none');
  expect(idle.label).toContain('SYS://STANDBY');
});

test('other Anby themes also use the Anby reaction set', async ({ page }) => {
  await startFixtureMovie(page, 'AnbyAltUser');

  for (const [title, id] of [['Anby', 'anby'], ['Anby Alt', 'anby-alt']]) {
    await page.click('.settings-panel-tab');
    await expect(page.locator('.settings-drawer')).toHaveClass(/open/);
    await page.locator(`.theme-grid button[title="${title}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
    await page.click('.settings-close');
    await expect(page.locator('.reaction-btn')).toHaveText(['🍔', '⚡', '🍜', '❤️']);

    const idle = await probeIdle(page);
    expect(idle.backgroundImage).toContain('anby-idle.webp');
  }
});

test('other themes keep their original reaction emoji and plain idle state', async ({ page }) => {
  await startFixtureMovie(page, 'PlainUser');

  await expect(page.locator('.reaction-btn')).toHaveText(['👏', '😂', '😱', '❤️']);

  const idle = await probeIdle(page);
  expect(idle.backgroundImage).toBe('none');
  expect(idle.label).toBe('none');
});
