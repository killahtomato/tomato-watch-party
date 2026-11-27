import { test, expect } from '@playwright/test';
import { joinRoom, seedHostTokens } from './harness.mjs';

test('host can stop a playing movie', async ({ page }) => {
  await seedHostTokens(page);
  await joinRoom(page, 'StopHost');

  await page.click('.movie-panel-tab:not(.web-panel-tab)');
  await page.getByRole('button', { name: /clip/ }).click();
  await expect(page.locator('.video-player video')).toBeVisible();

  await page.locator('.host-buttons .stop-btn').click();
  await expect(page.locator('.video-player.empty')).toBeVisible();
});
