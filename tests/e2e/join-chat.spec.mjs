import { test, expect } from '@playwright/test';
import { joinRoom } from './harness.mjs';

test('guest can join and send chat messages', async ({ page }) => {
  await joinRoom(page, 'Alice');
  await expect(page.locator('.chat')).toBeVisible();

  await page.fill('.chat-input input', 'hello from e2e');
  await page.click('.chat-input button');

  await expect(page.locator('.chat-text').filter({ hasText: 'hello from e2e' })).toBeVisible();
});

test('join produces a system message', async ({ page }) => {
  await joinRoom(page, 'Bob');
  await expect(page.locator('.chat-msg.system').filter({ hasText: 'joined' }).first()).toContainText('joined');
});
