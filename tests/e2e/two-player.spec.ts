/**
 * Two independent browser contexts (separate storage => separate demo-wallet keys)
 * play a complete staked match through the real UI: connect, sign in, profile,
 * faucet, matchmaking, escrow deposits, Fool's mate, onchain settlement.
 */
import { expect, test, type Page } from '@playwright/test';

const shots = process.env.E2E_SCREENSHOTS;

async function onboard(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /Enter the Arena/ }).first().click();
  await page.getByRole('button', { name: /STAKE Demo Wallet/ }).click();
  await page.getByRole('button', { name: /Sign message to continue/ }).click();
  await page.getByLabel('Username').fill(name);
  await page.getByRole('button', { name: 'Enter the Arena' }).last().click();
  await expect(page.getByRole('heading', { name: 'Arena' })).toBeVisible();
  await page.getByRole('button', { name: /Faucet/ }).click();
  await expect(page.getByRole('button', { name: /Find opponent/ })).toBeEnabled();
}

async function move(page: Page, from: string, to: string) {
  await page.locator(`#arena-board-square-${from}`).click();
  await page.locator(`#arena-board-square-${to}`).click();
}

test('two players stake, play and settle onchain', async ({ browser }) => {
  const suffix = Date.now().toString(36).slice(-5);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await onboard(a, `ana_${suffix}`);
  await onboard(b, `ben_${suffix}`);
  if (shots) await a.screenshot({ path: `${shots}/arena.png`, fullPage: true });

  // Same tier + demo time control on both sides.
  for (const p of [a, b]) {
    await p.getByRole('radio', { name: /^10 TEST/ }).click();
    await p.getByRole('radio', { name: /1\+0/ }).click();
  }
  await a.getByRole('button', { name: /Find opponent/ }).click();
  await expect(a.getByText('Searching for an opponent')).toBeVisible();
  if (shots) await a.screenshot({ path: `${shots}/queue.png` });
  await b.getByRole('button', { name: /Find opponent/ }).click();

  for (const p of [a, b]) await expect(p.getByRole('heading', { name: 'Fund the match' })).toBeVisible();
  for (const p of [a, b]) await expect(p.getByRole('button', { name: /Deposit 10 TEST/ })).toBeEnabled({ timeout: 60_000 });
  if (shots) await a.screenshot({ path: `${shots}/funding.png` });
  await a.getByRole('button', { name: /Deposit 10 TEST/ }).click();
  await expect(a.getByText(/locked in escrow/)).toBeVisible();
  await b.getByRole('button', { name: /Deposit 10 TEST/ }).click();

  // Game starts only after both deposits are verified onchain.
  for (const p of [a, b]) await expect(p.getByText(/Prize pool/)).toBeVisible();
  await expect(a.locator('#arena-board-board')).toBeVisible();

  const aIsWhite = await a.getByText('Your move').isVisible().catch(() => false);
  const white = aIsWhite ? a : b;
  const black = aIsWhite ? b : a;
  await expect(white.getByText('Your move')).toBeVisible();

  await move(white, 'f2', 'f3');
  await expect(black.getByText('Your move')).toBeVisible();
  await move(black, 'e7', 'e5');
  await expect(white.getByText('Your move')).toBeVisible();
  await move(white, 'g2', 'g4');
  await expect(black.getByText('Your move')).toBeVisible();
  if (shots) await black.screenshot({ path: `${shots}/game.png` });
  await move(black, 'd8', 'h4');

  await expect(black.getByText('Victory')).toBeVisible();
  await expect(white.getByText('Defeat')).toBeVisible();
  await expect(black.getByText('Checkmate').first()).toBeVisible();
  // A payout is only shown as confirmed after Solana confirms the settle instruction.
  await expect(black.getByText('Confirmed', { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(black.getByRole('link', { name: /View settlement on Explorer/ })).toBeVisible();
  if (shots) await black.screenshot({ path: `${shots}/result.png` });

  await black.getByRole('button', { name: 'View leaderboard' }).click();
  await expect(black.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  await expect(black.getByRole('row', { name: new RegExp(`ben_${suffix}|ana_${suffix}`) }).first()).toBeVisible();
  if (shots) await black.screenshot({ path: `${shots}/leaderboard.png` });

  await ctxA.close();
  await ctxB.close();
});
