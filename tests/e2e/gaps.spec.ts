/**
 * Task 11.2 (Requirements 8.4, 9.1, 9.5, 9.7, 9.11, 10.3, 10.5, 15.5) — the
 * gap-filling E2E scenario: clicking an uncovered stretch opens `ActivityDialog`
 * prefilled with exactly that range, and saving it through the dialog's own Save
 * button fills the gap.
 *
 * The dialog's Save button used to be unable to complete a create at all (see
 * .agents/ISSUES.md's formerly-open "Every write that carries a Preview_Token
 * always answers STALE_PREVIEW"; fixed in `src/lib/server/services/sessions.ts`/
 * `activities.ts` — the returned `previewToken` now reuses the same pre-mutation
 * fingerprint the confirming write compares against). The whole scenario,
 * including the save, is now driven through the real UI end to end.
 */
import { test, expect, login, createProject, createSessionViaApi, createActivityViaApi, findProjectId } from './fixtures';

const DAY = '2024-01-19';
const PROJECT_NAME = 'Research';

test('clicking an uncovered stretch opens the dialog prefilled with exactly that range', async ({ page }) => {
	await login(page);
	await createProject(page, PROJECT_NAME);
	const projectId = await findProjectId(page, PROJECT_NAME);

	// A single 3-hour session (09:00-12:00) with a 1-hour activity at the start
	// (09:00-10:00), leaving 10:00-12:00 uncovered.
	await createSessionViaApi(page, `${DAY}T08:00:00.000Z`, `${DAY}T11:00:00.000Z`);
	await createActivityViaApi(page, projectId, `${DAY}T08:00:00.000Z`, `${DAY}T09:00:00.000Z`, 'Reading');

	await page.goto(`/day/${DAY}`);

	// Click the uncovered stretch — its own aria-label names the range.
	await page.getByRole('button', { name: /Bez popisu, 10:00 – 12:00/ }).click();

	const dialog = page.getByRole('dialog', { name: 'Přidat úkol' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel('od')).toHaveValue('10:00');
	await expect(dialog.getByLabel('do')).toHaveValue('12:00');

	// Select a project and save through the dialog's own Save button — the
	// prefilled range is used exactly as shown, filling the gap end to end
	// through the real UI (including the confirm step, if the write's own
	// Dry_Run decides one is needed).
	await dialog.getByLabel('projekt').click();
	await dialog.getByRole('option', { name: PROJECT_NAME }).click();
	await page.waitForTimeout(700);
	await dialog.getByRole('button', { name: 'Uložit úkol', exact: true }).click();
	const confirmButton = dialog.getByRole('button', { name: 'Potvrdit a uložit' });
	if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
		await confirmButton.click();
	}
	await expect(dialog).toBeHidden();

	await page.reload();
	await expect(page.getByText('Celý den je popsaný.')).toBeVisible();
	const uncoveredRow = page.locator('.day-summary-panels__row', { hasText: 'Chybí popis' });
	await expect(uncoveredRow.locator('dd')).toHaveText('0 min');
});
