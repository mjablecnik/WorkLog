/**
 * Task 11.4 (Requirements 1.16, 1.17, 1.19, 1.20, 1.21, 1.22, 2.3, 2.5, 2.6, 2.7,
 * 13.4, 17.5, 17.6, 17.7) — the locale E2E scenario: switching language mid-page
 * changes the text with no reload and no lost scroll position.
 */
import { test, expect, login } from './fixtures';

test('switching to English mid-page changes text with no reload and no lost scroll position', async ({
	page
}) => {
	await login(page, { locale: 'cs' });

	// A short viewport, not the default ~720px tall one: the assertion below needs
	// `/projects` to actually have more content than fits on screen, or
	// `window.scrollTo(0, 120)` is a no-op and `scrollY` reads 0 regardless of
	// whether the locale switch preserves scroll position or not — confirmed live
	// once `src/app.css` started actually applying (a real page fits comfortably in
	// 720px with only a couple of seeded projects). A fixed short height guarantees
	// overflow regardless of how many projects a given run happens to have seeded.
	await page.setViewportSize({ width: 1280, height: 400 });

	await page.goto('/projects');
	await expect(page.getByRole('link', { name: 'Projekty', exact: true })).toBeVisible();

	// A scroll position and a client-side marker — a full reload would lose both.
	await page.evaluate(() => {
		window.scrollTo(0, 120);
		(window as unknown as { __e2eLocaleMarker?: boolean }).__e2eLocaleMarker = true;
	});

	await page.getByRole('button', { name: 'Otevřít nastavení' }).click();
	await page.getByRole('radio', { name: 'English' }).click();

	// Text changes immediately, in place.
	await expect(page.getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Projekty' })).toHaveCount(0);

	// No reload occurred.
	const markerStillSet = await page.evaluate(
		() => (window as unknown as { __e2eLocaleMarker?: boolean }).__e2eLocaleMarker === true
	);
	expect(markerStillSet).toBe(true);
	expect(page.url()).toContain('/projects');

	// Scroll position survived (a reload resets it to the top).
	const scrollY = await page.evaluate(() => window.scrollY);
	expect(scrollY).toBeGreaterThan(0);
});
