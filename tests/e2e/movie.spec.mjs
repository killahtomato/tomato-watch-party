import { test, expect } from '@playwright/test';
import { joinRoom, seedHostTokens } from './harness.mjs';

test.beforeEach(async ({ page }) => {
  await seedHostTokens(page);
});

test('host plays a movie and playback controls work', async ({ page }) => {
  await joinRoom(page, 'MovieHost');
  await page.click('.movie-panel-tab:not(.web-panel-tab)');
  await page.getByRole('button', { name: /clip/ }).click();

  const video = page.locator('.video-player video');
  await expect(video).toBeVisible();

  const playButton = page.locator('.host-buttons button').first();
  await expect(playButton).toContainText('Play');
  await playButton.click();
  await expect(playButton).toContainText('Pause');

  await page.selectOption('.quality-selector', '720p');
  await expect(page.locator('.quality-selector')).toHaveValue('720p');

  await page.selectOption('.subtitle-selector', { index: 1 });
  await expect(page.locator('.subtitle-selector')).not.toHaveValue('-1');
});

test('chat and throws work while a movie is playing', async ({ page }) => {
  await joinRoom(page, 'ChatMovie');
  await page.click('.movie-panel-tab:not(.web-panel-tab)');
  await page.getByRole('button', { name: /clip/ }).click();
  await page.locator('.host-buttons button').first().click();

  await page.fill('.chat-input input', 'watching together');
  await page.click('.chat-input button');
  await expect(page.locator('.chat-text').filter({ hasText: 'watching together' })).toBeVisible();

  await page.locator('.throw-btn.tomato').click();
  await expect(page.locator('.throw-item')).toHaveCount(1);

  await page.locator('.reaction-btn').first().click();
  await expect(page.locator('.reaction-float')).toHaveCount(1);
});
