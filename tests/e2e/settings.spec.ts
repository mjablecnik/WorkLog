/**
 * Task 11.4 (Requirements 1.16, 1.17, 1.19, 1.20, 1.21, 1.22, 2.3, 2.5, 2.6, 2.7,
 * 13.4, 17.5, 17.6, 17.7) — the `Settings_Menu` E2E scenario: the desktop anchored
 * popover vs. the mobile modal sheet, Escape/focus-return, the theme switcher with
 * no reload, first-paint correctness on reload, and following the system
 * `prefers-color-scheme`.
 */
import { test, expect, login } from './fixtures';

test('the desktop chip opens an anchored, non-modal popover', async ({ page }) => {
	await login(page);
	await page.goto('/');
	const chip = page.getByRole('button', { name: 'Otevřít nastavení' });
	await chip.click();
	const panel = page.locator('.settings-menu__panel--desktop');
	await expect(panel).toBeVisible();
	// No scrim on desktop — the popover is explicitly not modal.
	await expect(page.locator('.settings-menu__scrim')).toHaveCount(0);
});

test('Escape closes the menu and returns focus to the chip', async ({ page }) => {
	await login(page);
	await page.goto('/');
	const chip = page.getByRole('button', { name: 'Otevřít nastavení' });
	await chip.click();
	await expect(page.locator('.settings-menu__panel--desktop')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.locator('.settings-menu__panel--desktop')).toBeHidden();
	await expect(chip).toBeFocused();
});

test('the mobile chip opens a modal sheet with the bottom nav visible beneath the scrim', async ({
	page
}) => {
	await page.setViewportSize({ width: 375, height: 700 });
	await login(page);
	await page.goto('/');
	// Let the shell's live matchMedia-corrected density settle post-hydration.
	await page.waitForTimeout(300);

	const chip = page.getByRole('button', { name: 'Otevřít nastavení' });
	await chip.click();
	const sheet = page.locator('.settings-menu__panel--mobile');
	await expect(sheet).toBeVisible();
	await expect(page.locator('.settings-menu__scrim')).toBeVisible();

	// The bottom nav stays in the DOM, visible beneath the scrim (in a lower
	// stacking layer) — never dimmed via `opacity` (design.md: an opacity would
	// create a stacking context and paint the tab bar over the sheet).
	const bottomNav = page.locator('nav').filter({ has: page.getByRole('link', { name: 'Timer' }) });
	await expect(bottomNav).toBeVisible();
	const navOpacity = await bottomNav.evaluate((el) => getComputedStyle(el).opacity);
	expect(navOpacity).toBe('1');
	const bodyOpacity = await page.evaluate(() => getComputedStyle(document.body).opacity);
	expect(bodyOpacity).toBe('1');
});

test('switching to the light theme changes data-theme with no reload', async ({ page }) => {
	await login(page, { theme: 'dark' });
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

	await page.evaluate(() => {
		(window as unknown as { __e2eThemeMarker?: boolean }).__e2eThemeMarker = true;
	});

	await page.getByRole('button', { name: 'Otevřít nastavení' }).click();
	await page.getByRole('radio', { name: 'Světlý' }).click();

	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	const markerStillSet = await page.evaluate(
		() => (window as unknown as { __e2eThemeMarker?: boolean }).__e2eThemeMarker === true
	);
	expect(markerStillSet).toBe(true);

	// Reload: the theme is applied before first paint — the raw server-rendered
	// HTML already carries the right `data-theme`, not just the post-hydration DOM.
	const res = await page.request.get('/');
	const html = await res.text();
	expect(html).toContain('data-theme="light"');

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the "Systém" preference follows the emulated prefers-color-scheme with no reload', async ({
	page
}) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await login(page, { theme: 'light' });
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

	await page.getByRole('button', { name: 'Otevřít nastavení' }).click();
	await page.getByRole('radio', { name: 'Systém' }).click();
	// Emulated prefers-color-scheme is dark — following it, live, no reload.
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

	// Flip the emulated media query and confirm the live matchMedia listener
	// (registered whenever the preference is 'system') follows it too.
	await page.emulateMedia({ colorScheme: 'light' });
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
