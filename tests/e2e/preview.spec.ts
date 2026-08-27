/**
 * Task 11.2 (Requirements 8.4, 9.1, 9.5, 9.7, 9.11, 10.3, 10.5, 15.5) — the preview
 * E2E scenario: shortening a `Work_Session` that carries an `Activity_Entry`
 * through `SessionDialog`.
 *
 * Previously blocked by the STALE_PREVIEW bug formerly documented in
 * `.agents/ISSUES.md` ("Every write that carries a Preview_Token always answers
 * STALE_PREVIEW"): confirming ANY Dry_Run-previewed write — create OR patch,
 * session OR activity — was unconditionally rejected, because the token a dry run
 * handed back was fingerprinted AFTER the mutation it was previewing while the
 * real write's own freshness check always compared against the state BEFORE it.
 * Fixed in `src/lib/server/services/sessions.ts`'s `finishWrite` and
 * `activities.ts`'s `create`/`patchActivity` (the returned `previewToken` now
 * reuses the same pre-mutation fingerprint as the comparison, instead of
 * re-fingerprinting after the write). Both halves of this scenario — previewing
 * and cancelling, and previewing and confirming — are now driven through the
 * real UI end to end, including the "Potvrdit a uložit" click this file used to
 * have to route around.
 */
import { test, expect, login, createProject, createSessionViaApi, createActivityViaApi, findProjectId } from './fixtures';

const DAY = '2024-01-17';
const PROJECT_NAME = 'Deep Work';

test('shortening a session previews the loss and can be cancelled without saving', async ({ page }) => {
	await login(page);
	await createProject(page, PROJECT_NAME);
	const projectId = await findProjectId(page, PROJECT_NAME);

	// A 4-hour session (09:00-13:00 Prague = 08:00Z-12:00Z) carrying a 3-hour
	// activity (09:00-12:00) that leaves the last hour (12:00-13:00) uncovered.
	await createSessionViaApi(page, `${DAY}T08:00:00.000Z`, `${DAY}T12:00:00.000Z`);
	await createActivityViaApi(page, projectId, `${DAY}T08:00:00.000Z`, `${DAY}T11:00:00.000Z`, 'Writing');

	await page.goto(`/day/${DAY}`);

	// Open the session for editing via its Work_Block head.
	await page.getByRole('button', { name: /Úsek timeru 09:00/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Upravit úsek timeru' });
	await expect(dialog).toBeVisible();

	// Shorten the end from 13:00 to 11:00 — the activity's 09:00-12:00 segment
	// loses its last hour, and the previously-uncovered 12:00-13:00 hour falls
	// outside the new frame entirely (Uncovered_Time that disappears).
	await dialog.getByLabel('konec').fill('11:00');
	await page.waitForTimeout(700);
	await dialog.getByRole('button', { name: 'Uložit', exact: true }).click();

	const confirmButton = dialog.getByRole('button', { name: 'Potvrdit a uložit' });
	await confirmButton.waitFor({ state: 'visible', timeout: 8000 });

	// The preview names the affected entry (the project it belongs to), the
	// minutes it loses, and the Uncovered_Time stretch outside the new frame.
	await expect(dialog.getByText(PROJECT_NAME)).toBeVisible();
	await expect(dialog.locator('.change-preview__entry-loss')).toContainText('1 h 00 min');
	await expect(dialog.locator('.change-preview__uncovered-text')).toBeVisible();
	await expect(dialog.locator('.change-preview__uncovered-text')).toContainText('1 h 00 min');

	// Cancel: back to editing, then close without saving.
	await dialog.getByRole('button', { name: 'Zpět k úpravě' }).click();
	await expect(dialog.getByRole('button', { name: 'Uložit', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Zrušit', exact: true }).click();
	await expect(dialog).toBeHidden();

	// Nothing changed server-side: reload and confirm the session is still 09:00-13:00.
	await page.reload();
	await expect(page.getByText('09:00 – 13:00')).toBeVisible();
});

const DAY2 = '2024-01-18';

test('confirming the shortened session saves through the real confirm step', async ({ page }) => {
	await login(page);
	await createProject(page, PROJECT_NAME);
	const projectId = await findProjectId(page, PROJECT_NAME);
	await createSessionViaApi(page, `${DAY2}T08:00:00.000Z`, `${DAY2}T12:00:00.000Z`);
	await createActivityViaApi(page, projectId, `${DAY2}T08:00:00.000Z`, `${DAY2}T11:00:00.000Z`, 'Writing');

	await page.goto(`/day/${DAY2}`);
	await page.getByRole('button', { name: /Úsek timeru 09:00/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Upravit úsek timeru' });
	await dialog.getByLabel('konec').fill('11:00');
	await page.waitForTimeout(700);
	await dialog.getByRole('button', { name: 'Uložit', exact: true }).click();
	const confirmButton = dialog.getByRole('button', { name: 'Potvrdit a uložit' });
	await confirmButton.waitFor({ state: 'visible', timeout: 8000 });
	await confirmButton.click();

	// The confirm succeeds and the dialog closes — this is the exact round trip
	// (dry-run preview, then a real PATCH carrying the same Preview_Token) the
	// STALE_PREVIEW bug used to reject unconditionally.
	await expect(dialog).toBeHidden();

	// Verified on the real, re-rendered Day_Timeline: the session is now
	// 09:00-11:00, and the 12:00-13:00 stretch the shortened end dropped is gone.
	await page.reload();
	await expect(page.getByText('09:00 – 11:00').first()).toBeVisible();
	await expect(page.getByText('12:00 – 13:00')).toHaveCount(0);
});

// .agents/ISSUES.md, "gaps.spec.ts and preview.spec.ts both hardcode 2024-01-19" —
// gaps.spec.ts creates its own Work_Session on that date, and the full suite's
// single shared database (one reset per whole run, not per file) meant the two
// collided with 409 SESSION_OVERLAP whichever ran second. 2024-01-25 is unclaimed
// by any other tests/e2e/*.spec.ts file — grep before reusing this pattern.
const DAY3 = '2024-01-25';

test('shortening a session over pure Uncovered_Time now shows Confirming instead of auto-saving', async ({
	page
}) => {
	// .agents/ISSUES.md, "SessionDialog's Editing->Confirming shortcut ignores
	// lostUncoveredSeconds" — the narrow case that used to skip Confirming and save
	// immediately: a session edit that only shrinks Uncovered_Time, with no
	// Activity_Entry involved at all (removedSeconds stays 0, reclipped stays empty),
	// so the old two-way shortcut condition let it straight through even though
	// ChangePreview's own three-way `sessionHasLoss` check would have rendered it as
	// a loss. The widened shortcut must now agree and stop at Confirming instead.
	await login(page);

	// A 4-hour session (09:00-13:00 Prague = 08:00Z-12:00Z) with no Activity_Entry at
	// all — every minute of it is Uncovered_Time.
	await createSessionViaApi(page, `${DAY3}T08:00:00.000Z`, `${DAY3}T12:00:00.000Z`);

	await page.goto(`/day/${DAY3}`);
	await page.getByRole('button', { name: /Úsek timeru 09:00/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Upravit úsek timeru' });
	await expect(dialog).toBeVisible();

	// Shorten the end from 13:00 to 11:00 — no Activity_Entry is touched, but the
	// 11:00-13:00 stretch that WAS Uncovered_Time falls outside the new frame.
	await dialog.getByLabel('konec').fill('11:00');
	await page.waitForTimeout(700);
	await dialog.getByRole('button', { name: 'Uložit', exact: true }).click();

	// This must NOT save immediately: Confirming shows, naming the lost
	// Uncovered_Time, and the dialog stays open until confirmed.
	const confirmButton = dialog.getByRole('button', { name: 'Potvrdit a uložit' });
	await confirmButton.waitFor({ state: 'visible', timeout: 8000 });
	await expect(dialog.locator('.change-preview__uncovered-text')).toBeVisible();
	await expect(dialog.locator('.change-preview__uncovered-text')).toContainText('2 h 00 min');
	await expect(dialog).toBeVisible();

	// Confirming performs the real write.
	await confirmButton.click();
	await expect(dialog).toBeHidden();

	await page.reload();
	await expect(page.getByText('09:00 – 11:00').first()).toBeVisible();
	await expect(page.getByText('12:00 – 13:00')).toHaveCount(0);
});
