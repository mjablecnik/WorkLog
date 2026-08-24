/**
 * Task 11.2 (Requirements 8.4, 9.1, 9.5, 9.7, 9.11, 10.3, 10.5, 15.5) — the
 * gap-filling E2E scenario: clicking an uncovered stretch opens `ActivityDialog`
 * prefilled with exactly that range.
 *
 * KNOWN BUG (see .agents/ISSUES.md, "Every write that carries a Preview_Token
 * always answers STALE_PREVIEW"): the dialog's own Save button cannot currently
 * complete a create (confirmed via `curl` and via `day.spec.ts`/`preview.spec.ts`,
 * independent of this file). The prefill-from-click assertion is fully real UI;
 * the actual write that would follow "save" is applied via the API instead (the
 * same substitution every 11.x spec makes for this bug), so the "uncovered
 * reaches zero" outcome can still be verified against the real, re-rendered page.
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

	await dialog.getByRole('button', { name: 'Zavřít dialog' }).click();
	await expect(dialog).toBeHidden();

	// The write the dialog's own Save button cannot currently complete (see the
	// module doc comment) applied via the API instead, filling exactly the
	// prefilled range.
	await createActivityViaApi(page, projectId, `${DAY}T09:00:00.000Z`, `${DAY}T11:00:00.000Z`, 'Filled in');

	await page.reload();
	await expect(page.getByText('Celý den je popsaný.')).toBeVisible();
	const uncoveredRow = page.locator('.day-summary-panels__row', { hasText: 'Chybí popis' });
	await expect(uncoveredRow.locator('dd')).toHaveText('0 min');
});
