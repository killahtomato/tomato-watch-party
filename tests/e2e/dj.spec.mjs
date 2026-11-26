import { test, expect } from '@playwright/test';
import { joinRoom, seedHostTokens } from './harness.mjs';

test('DJ can start a track from the track list', async ({ page }) => {
  await seedHostTokens(page);
  await joinRoom(page, 'DeeJay');
  await page.locator('.room-switcher .room-btn').nth(1).click();
  await expect(page.locator('.dj-room')).toBeVisible();

  const firstTrack = page.locator('.dj-track').first();
  await expect(firstTrack).toBeVisible();
  await firstTrack.click();

  const playButton = page.locator('.dj-controls button').last();
  await expect(playButton).toContainText('Play');
  await playButton.click();
  await expect(playButton).toContainText('Pause');

  await expect(page.locator('.dj-time')).not.toContainText('0:00 /');
});
