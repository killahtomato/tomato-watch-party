import { test, expect } from '@playwright/test';
import { joinRoom } from './harness.mjs';

test('theme, accent and chat size settings apply to the document', async ({ page }) => {
  await joinRoom(page, 'SettingsUser');
  await page.click('.settings-panel-tab');
  await expect(page.locator('.settings-drawer')).toHaveClass(/open/);

  await page.locator('.theme-grid button[title="Sepia"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');

  await page.locator('.accent-swatch[title="Blue"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');

  await page.locator('[data-setting="chatSize"] button', { hasText: 'Large' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-chat-size', 'lg');
});

test('reduce motion flips the motion attribute', async ({ page }) => {
  await joinRoom(page, 'MotionUser');
  await page.click('.settings-panel-tab');
  await page.locator('[data-setting="reduceMotion"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});
