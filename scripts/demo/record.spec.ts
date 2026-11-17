/**
 * Drives the REAL app (two browser contexts = two wallets) through a full staked match
 * and records both screens. Writes footage + scene markers to $DEMO_OUT.
 * Nothing is mocked: matchmaking, escrow deposits, gameplay and settlement are live.
 */
import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const OUT = process.env.DEMO_OUT!;
const VIEW = { width: 1280, height: 800 };
const pause = (p: Page, ms: number) => p.waitForTimeout(ms);

test('record demo', async ({ browser }) => {
  const sfx = Date.now().toString(36).slice(-3);
  const names = { a: `magnus_${sfx}`, b: `judit_${sfx}` };
  const mk = async () => browser.newContext({ viewport: VIEW, recordVideo: { dir: OUT, size: VIEW } });
  const ctxA: BrowserContext = await mk();
  const a = await ctxA.newPage();
  const t0a = Date.now();
  const ctxB: BrowserContext = await mk();
  const b = await ctxB.newPage();
  const t0b = Date.now();
  const marks: Record<string, number> = {};
  const mark = (k: string) => (marks[k] = Date.now() - t0a);

  // B idles on a neutral page until its scenes start
  await b.goto('/');

  // ── Landing (A)
  await a.goto('/');
  mark('landing');
  await pause(a, 5000);
  await a.mouse.wheel(0, 700);
  await pause(a, 3500);
  await a.mouse.wheel(0, -700);
  await pause(a, 1500);

  // ── Onboarding both
  mark('onboard');
  for (const [p, name] of [[a, names.a], [b, names.b]] as const) {
    await p.getByRole('button', { name: /Enter the Arena/ }).first().click();
    await pause(p, 900);
    await p.getByRole('button', { name: /STAKE Demo Wallet/ }).click();
    await pause(p, 900);
    await p.getByRole('button', { name: /Sign message to continue/ }).click();
    await p.getByLabel('Username').pressSequentially(name, { delay: 45 });
    await pause(p, 500);
    await p.getByRole('button', { name: 'Enter the Arena' }).last().click();
    await expect(p.getByRole('heading', { name: 'Arena' })).toBeVisible();
    await pause(p, 800);
    await p.getByRole('button', { name: /Faucet/ }).click();
    await expect(p.getByRole('button', { name: /Find opponent/ })).toBeEnabled();
    await pause(p, 1200);
  }

  // ── Matchmaking
  mark('matchmaking');
  for (const p of [a, b]) {
    await p.getByRole('radio', { name: /^10 TEST/ }).click();
    await p.getByRole('radio', { name: /^3\+0/ }).click();
  }
  await pause(a, 2000);
  await a.getByRole('button', { name: /Find opponent/ }).click();
  await expect(a.getByText('Searching for an opponent')).toBeVisible();
  await pause(a, 4000);
  await b.getByRole('button', { name: /Find opponent/ }).click();

  // ── Funding
  for (const p of [a, b]) await expect(p.getByRole('heading', { name: 'Fund the match' })).toBeVisible();
  mark('funding');
  for (const p of [a, b]) await expect(p.getByRole('button', { name: /Deposit 10 TEST/ })).toBeEnabled();
  await pause(a, 3500);
  await a.getByRole('button', { name: /Deposit 10 TEST/ }).click();
  await expect(a.getByText(/locked in escrow/)).toBeVisible();
  await pause(a, 3000);
  await b.getByRole('button', { name: /Deposit 10 TEST/ }).click();

  // ── Game
  for (const p of [a, b]) await expect(p.getByText(/Prize pool/)).toBeVisible();
  mark('game');
  const aIsWhite = await a.getByText('Your move').isVisible().catch(() => false);
  const [white, black] = aIsWhite ? [a, b] : [b, a];
  const sq = (p: Page, s: string) => p.locator(`#arena-board-square-${s}`);
  const move = async (p: Page, from: string, to: string) => {
    await expect(p.getByText('Your move')).toBeVisible();
    await pause(p, 1400);
    await sq(p, from).click();
    await pause(p, 700);
    await sq(p, to).click();
  };
  await pause(a, 2000);
  await move(white, 'f2', 'f3');
  await move(black, 'e7', 'e5');
  await move(white, 'g2', 'g4');
  await move(black, 'd8', 'h4');

  // ── Result + settlement
  await expect(black.getByText('Victory')).toBeVisible();
  mark('result');
  await expect(black.getByText('Confirmed', { exact: true })).toBeVisible({ timeout: 90_000 });
  mark('settled');
  await pause(a, 7000);

  // ── Profile & leaderboard (winner = black)
  mark('profile');
  await black.getByRole('button', { name: /History/ }).click();
  await expect(black.getByText('Rating history')).toBeVisible();
  await pause(black, 5000);
  await black.mouse.wheel(0, 500);
  await pause(black, 3500);
  mark('leaderboard');
  await black.goto('/leaderboard');
  await pause(black, 5000);
  mark('end');

  const matchId = new URL(white === a ? a.url() : b.url()).pathname.split('/').pop();
  await ctxA.close();
  await ctxB.close();
  writeFileSync(
    `${OUT}/markers.json`,
    JSON.stringify(
      {
        marks,
        offsetB: t0b - t0a,
        videoA: await a.video()!.path(),
        videoB: await b.video()!.path(),
        winner: black === a ? 'a' : 'b',
        names,
        matchUrl: white.url(),
        matchId,
      },
      null,
      2,
    ),
  );
});
