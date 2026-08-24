/**
 * Task 11.5 (Requirements 14.1, 14.5, 14.10, 14.11, 14.25, 15.13, 15.15) — the
 * interaction half of the accessibility/responsive pass: a keyboard-only walk of
 * the day page, a visible focus ring on every focused control, a success toast
 * announced through the live region while the elapsed readout is not, and no
 * active transform transition under an emulated `prefers-reduced-motion: reduce`.
 */
import { test, expect, login, createProject, createSessionViaApi, createActivityViaApi, findProjectId } from './fixtures';

const DAY = '2024-01-22';

async function tabUntil(
	page: import('@playwright/test').Page,
	predicate: () => Promise<boolean>,
	maxPresses = 150
): Promise<void> {
	for (let i = 0; i < maxPresses; i++) {
		if (await predicate()) return;
		await page.keyboard.press('Tab');
	}
	const active = await page.evaluate(() => {
		const el = document.activeElement;
		return el ? `${el.tagName}.${el.className}` : 'null';
	});
	throw new Error(`tabUntil: predicate never matched within ${maxPresses} presses (last focus: ${active})`);
}

test('a keyboard-only walk reaches a timeline block, opens the dialog, and submits an edit', async ({
	page
}) => {
	// This edit used to be rejected by the STALE_PREVIEW bug formerly documented
	// in .agents/ISSUES.md ("Every write that carries a Preview_Token always
	// answers STALE_PREVIEW"; fixed in `src/lib/server/services/activities.ts`).
	// A metadata-only edit needs no reclip, so `ActivityDialog`'s Save submits
	// directly (no "Potvrdit a uložit" confirm screen) — that direct submit is
	// exactly the shape the bug used to reject unconditionally, so this is also
	// the regression test for it, driven entirely by keyboard with no pointer
	// interaction anywhere in the test.
	await login(page);
	await createProject(page, 'Focus');
	const projectId = await findProjectId(page, 'Focus');
	await createSessionViaApi(page, `${DAY}T08:00:00.000Z`, `${DAY}T11:00:00.000Z`);
	await createActivityViaApi(page, projectId, `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, 'Original text');

	await page.goto(`/day/${DAY}`);

	// Tab from the top of the document until a Day_Timeline segment is focused —
	// no pointer interaction anywhere in this test. Bounded well short of the
	// day-nav DatePicker later in tab order: focusing it consumes several Tab
	// presses navigating its own day/month/year sub-fields without changing
	// `document.activeElement` at all, so an unbounded search that overshoots
	// the timeline can end up stuck there instead of ever failing loudly.
	await tabUntil(
		page,
		() => page.evaluate(() => document.activeElement?.hasAttribute('data-entry-id') ?? false),
		25
	);
	await page.keyboard.press('Enter');

	const dialog = page.getByRole('dialog', { name: 'Upravit úkol' });
	await expect(dialog).toBeVisible();

	// Tab to the description textarea and change it — a metadata-only edit
	// (the interval stays the same, only the description changes), which the
	// STALE_PREVIEW bug documented in .agents/ISSUES.md does not affect: that
	// bug only breaks the token comparison at submit time, not the dry run
	// that decides whether the Save button is enabled at all.
	await tabUntil(
		page,
		() => page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'),
		20
	);
	await page.keyboard.press('Control+A');
	await page.keyboard.type('Updated via keyboard');
	// The Save button stays disabled — and out of the tab order, since a
	// disabled button never is one — until the 400ms debounced Dry_Run this
	// edit still triggers (it watches every field, description included)
	// resolves to a non-rejected preview.
	await page.waitForTimeout(1000);

	// Tab to the submit button and activate it with Enter. It's a `Button`
	// component with an `onclick` handler (not a native `type="submit"`), so
	// the search matches on its accessible name.
	await tabUntil(
		page,
		() => page.evaluate(() => document.activeElement?.textContent?.includes('Uložit úkol') ?? false),
		15
	);
	await page.keyboard.press('Enter');

	// The edit saves and the dialog closes — the direct-submit round trip the
	// STALE_PREVIEW bug used to reject unconditionally.
	await expect(dialog).toBeHidden();
	await page.reload();
	await expect(page.getByText('Updated via keyboard')).toBeVisible();
});

test('a keyboard-focused control shows a visible focus ring', async ({ page }) => {
	// Formerly documented the CURRENT (broken) state as a regression test — see
	// .agents/ISSUES.md, "src/app.css is never imported" (now RESOLVED,
	// 2026-08-24-0659: `src/routes/+layout.svelte` imports it). Flipped to
	// assert the requirement's actual intent now that the design tokens
	// `:focus-visible`'s box-shadow depends on (`--focus-gap`, `--accent`)
	// reach the real page.
	await login(page);
	await page.goto('/');

	const chip = page.getByRole('button', { name: 'Otevřít nastavení' });
	const unfocusedBoxShadow = await chip.evaluate((el) => getComputedStyle(el).boxShadow);

	// A real keyboard Tab, not `.focus()` — :focus-visible's own heuristic does
	// not reliably activate for a script-triggered focus with no prior keyboard
	// interaction in the page, which would make this check pass or fail for the
	// wrong reason.
	await tabUntil(
		page,
		async () => {
			const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
			return name === 'Otevřít nastavení';
		},
		15
	);
	await expect(chip).toBeFocused();
	const focusedBoxShadow = await chip.evaluate((el) => getComputedStyle(el).boxShadow);

	expect(focusedBoxShadow).not.toBe(unfocusedBoxShadow);
	expect(focusedBoxShadow).not.toBe('none');
});

test('a success toast is announced through the live region; the elapsed readout is not', async ({
	page
}) => {
	await login(page);
	await createProject(page, 'Focus');
	await page.goto('/');

	const liveRegion = page.locator('[role="status"][aria-live="polite"]');
	await expect(liveRegion).toHaveCount(1);

	await page.getByRole('button', { name: 'Spustit timer' }).click();
	await expect(page.getByRole('button', { name: 'Zastavit timer' })).toBeVisible();
	await page.getByRole('button', { name: 'Zastavit timer' }).click();
	// The stop action's own success surfaces through the live region.
	await expect(liveRegion).toBeVisible();

	// The ticking elapsed readout itself carries no aria-live and is not the
	// live region — announcing it every second would spam a screen reader.
	const heroValue = page.locator('.timer-page__hero-value');
	await expect(heroValue).not.toHaveAttribute('aria-live', /.+/);
	const isInsideLiveRegion = await heroValue.evaluate(
		(el) => el.closest('[aria-live]') !== null
	);
	expect(isInsideLiveRegion).toBe(false);
});

test('no element carries an active transform transition under prefers-reduced-motion: reduce', async ({
	page
}) => {
	// Now that .agents/ISSUES.md's "src/app.css is never imported" is RESOLVED
	// (2026-08-24-0659) and the real design tokens reach the page, this needed
	// a second look — and the original assertion was checking the wrong thing.
	// `theme.css`'s reduced-motion block does not set `animation-name: none`;
	// it uses the standard technique of collapsing every animation's DURATION
	// to near-zero instead (`*, *::before, *::after { animation-duration:
	// 0.01ms !important; animation-iteration-count: 1 !important; }`), which
	// still reports the keyframe's own name via `animationName` — that is not
	// a bug, just a different (and more broadly compatible) way of expressing
	// "no visible motion." Asserting on `animationDuration` instead is what
	// actually verifies the entrance keyframe cannot be seen running.
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await login(page);
	await page.goto('/');

	// Open the Settings_Menu — its panel is one of the surfaces theme.css's own
	// reduced-motion block names as an "instant state change" candidate
	// (dialogs, menus, toasts).
	await page.getByRole('button', { name: 'Otevřít nastavení' }).click();
	const panel = page.locator('.settings-menu__panel--desktop');
	await expect(panel).toBeVisible();

	const transitionProperty = await panel.evaluate((el) => getComputedStyle(el).transitionProperty);
	const animationDurationMs = await panel.evaluate((el) => {
		// getComputedStyle normalizes the unit itself (Chromium reports seconds,
		// e.g. "1e-05s", for the "0.01ms" theme.css actually declares) — parse
		// numerically rather than comparing the raw string.
		const raw = getComputedStyle(el).animationDuration;
		const seconds = parseFloat(raw);
		return raw.endsWith('ms') ? seconds : seconds * 1000;
	});
	const hasTransformTransition = transitionProperty.includes('transform');
	expect(hasTransformTransition, `transition-property: ${transitionProperty}`).toBe(false);
	expect(
		animationDurationMs,
		'the entrance keyframe animation should collapse to near-zero'
	).toBeLessThanOrEqual(0.01);
});
