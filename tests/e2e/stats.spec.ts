/**
 * Live-browser regression for `.agents/ISSUES.md`, "`DayRhythm.svelte`'s
 * covered/leisure segment rects have no `fill` CSS rule at all" — the component's
 * own jsdom unit test (`tests/modules/stats/components/stats.test.ts`) only ever
 * asserted the CSS *class* was present, never the resolved `fill` a real browser
 * computes, which is exactly how a plain-black-instead-of-project-colour bug
 * survived undetected. `getComputedStyle` needs a real rendering engine — jsdom
 * does not apply this component's `<style>` block reliably — so this belongs in
 * Playwright, not Vitest.
 *
 * Seeds on the Monday of the real current week (the default `/stats` range is
 * always the week containing "today", never an arbitrary fixed date) at 01:00-02:30
 * UTC specifically to stay clear of "now" even if the test happens to run on that
 * Monday itself — mirrors this project's own established pattern for E2E fixtures
 * anchored to the real clock (see run 2026-08-26-0758's FIX-CAT-UI-* fixtures).
 */
import { test, expect, login, createProject, createSessionViaApi, createActivityViaApi, findProjectId } from './fixtures';

/** The real current week's Monday, via the app's own resolved `today` (BottomNav's
 * `/day/<date>` link) rather than guessing at Logical_Day/timezone arithmetic. */
async function mondayOfCurrentWeek(page: import('@playwright/test').Page): Promise<string> {
	await page.goto('/');
	const href = await page.locator('a[href^="/day/"]').first().getAttribute('href');
	if (!href) throw new Error('mondayOfCurrentWeek: no /day/<date> link found on the timer page');
	const today = href.replace('/day/', '');
	const [y, m, d] = today.split('-').map(Number);
	const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday .. 6 = Saturday
	const daysSinceMonday = (weekday + 6) % 7;
	const monday = new Date(Date.UTC(y, m - 1, d - daysSinceMonday));
	return monday.toISOString().slice(0, 10);
}

test('a covered and a leisure segment render in their real colour, not the SVG default black', async ({
	page
}) => {
	await login(page);
	await createProject(page, 'Rhythm Colour');
	const projectId = await findProjectId(page, 'Rhythm Colour');

	const day = await mondayOfCurrentWeek(page);
	await createSessionViaApi(page, `${day}T01:00:00.000Z`, `${day}T02:00:00.000Z`);
	await createActivityViaApi(page, projectId, `${day}T01:00:00.000Z`, `${day}T02:00:00.000Z`, 'Work');
	await createActivityViaApi(page, null, `${day}T02:00:00.000Z`, `${day}T02:30:00.000Z`, 'Rest');

	await page.goto('/stats');
	const segments = page.locator('.day-rhythm__segment:not(.day-rhythm__segment--uncovered)');
	await expect(segments.first()).toBeAttached();

	const fills = await segments.evaluateAll((els) => els.map((el) => getComputedStyle(el).fill));
	expect(fills.length).toBeGreaterThanOrEqual(2);
	for (const fill of fills) {
		expect(fill, `resolved fill was ${fill}`).not.toBe('rgb(0, 0, 0)');
		expect(fill).not.toBe('');
	}
});
