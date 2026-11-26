import { test, expect } from '@playwright/test';
import { joinRoom } from './harness.mjs';

test('a socket blip does not drop the session', async ({ page, context }) => {
  await joinRoom(page, 'FlakyViewer');
  await expect(page.locator('.chat')).toBeVisible();

  // Simulate a network drop; socket.io should reconnect without a reload.
  await context.setOffline(true);
  await page.waitForTimeout(1500);
  await context.setOffline(false);

  // Let the socket reconnect and the app auto-rejoin. The session must survive
  // (never returning to the name entry) and chat must work without a reload.
  await expect(page.locator('.room-switcher')).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.locator('.room-switcher')).toBeVisible();
  await page.fill('.chat-input input', 'still here');
  await page.click('.chat-input button');
  await expect(page.locator('.chat-text').filter({ hasText: 'still here' })).toBeVisible();
});
