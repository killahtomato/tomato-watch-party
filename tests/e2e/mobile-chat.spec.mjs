import { test, expect } from '@playwright/test';

async function mobileUser(browser, name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3100/m/');
  await page.fill('input', name);
  await page.getByRole('button', { name: 'Join' }).click();
  await page.waitForSelector('.mobile-header');
  const tap = page.locator('.tap-to-start');
  if (await tap.count()) await tap.click();
  return { context, page };
}

const counts = (page) => page.evaluate(() => ({
  overlay: document.querySelectorAll('.mobile-slide-overlay').length,
  bodies: document.querySelectorAll('.mobile-chat-body').length,
  texts: document.querySelectorAll('.mobile-chat-body .chat-text').length,
}));

test('mobile chat keeps messages sent while the panel was closed', async ({ browser }) => {
  const a = await mobileUser(browser, 'MobiChatA');
  const b = await mobileUser(browser, 'MobiChatB');

  const send = async (page, text) => {
    await page.fill('.chat-input input', text);
    await page.click('.chat-input button');
  };

  try {
    await a.page.click('.mobile-chat-btn');
    await expect(a.page.locator('.mobile-chat-body')).toBeVisible();
    await send(a.page, 'one');

    await b.page.click('.mobile-chat-btn');
    await send(b.page, 'two');
    await expect(a.page.locator('.mobile-chat-body .chat-text')).toContainText(['one', 'two']);

    // Close A's panel.
    await a.page.click('.mobile-slide-close');
    await a.page.waitForFunction(() => document.querySelectorAll('.mobile-slide-overlay').length === 0);

    // B sends while A's panel is closed.
    await send(b.page, 'three');
    await a.page.waitForTimeout(500);

    // Reopen A's panel.
    await a.page.click('.mobile-chat-btn');
    await expect(a.page.locator('.mobile-chat-body')).toBeVisible();
    await a.page.waitForTimeout(500);

    const texts = await a.page.locator('.mobile-chat-body .chat-text').allTextContents();
    expect(texts).toEqual(expect.arrayContaining(['one', 'two', 'three']));
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
