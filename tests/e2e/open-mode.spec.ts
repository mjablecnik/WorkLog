/**
 * Task 11.3 (Requirements 6.6, 6.12, 6.13) — the `Open_Mode` E2E scenario: logging
 * through the timer page's `Quick_Log` pill, and logging through `ActivityDialog`'s
 * third mode ("Od posledního") over an equivalent frame, produce the same shape of
 * result — a single segment running from the `Placement_Anchor` (an `Open_Session`'s
 * own start, when nothing has been described yet) to the moment of submission.
 *
 * Both halves are now driven through the real UI end to end. `Quick_Log`'s own
 * hidden form never attaches a `Preview_Token` (`QuickLog.svelte`: only
 * `projectId`/`date`), so it was always unaffected by the STALE_PREVIEW bug formerly
 * documented in `.agents/ISSUES.md` ("Every write that carries a Preview_Token always
 * answers STALE_PREVIEW"). `ActivityDialog`'s `Open_Mode` create WAS affected (its
 * hidden wire form always attaches the token once a preview resolves, same as every
 * other mode) — that bug is fixed (see `src/lib/server/services/sessions.ts`'s
 * `finishWrite`/`src/lib/server/services/activities.ts`'s `create`/`patchActivity`:
 * the `Preview_Token` handed back to the client now reuses the pre-mutation
 * fingerprint instead of recomputing one after the write), so this half now clicks
 * through the same dialog Quick_Log is being compared against, instead of issuing
 * the equivalent request directly against the API.
 */
import { test, expect, login, createProject, createSessionViaApi, createActivityViaApi, findProjectId } from './fixtures';

const PROJECT_NAME = 'Support Queue';

test('Quick_Log and Activity_Dialog Open_Mode both log since the running session started', async ({
	page
}) => {
	test.setTimeout(180000);
	await login(page);
	await createProject(page, PROJECT_NAME);
	const seedProjectId = await findProjectId(page, PROJECT_NAME);

	// Quick_Log's project comes from the most recently logged Activity_Entry
	// ANYWHERE (`+page.server.ts`: `dayLastEntry ?? mostRecentEntry(tx)`) — with
	// no entry ever logged at all, quickLog stays null regardless of any gap's
	// length ("Není co zapsat"). Seed one, on an unrelated past day, purely so
	// the pill has a project to suggest.
	await createSessionViaApi(page, '2020-01-01T08:00:00.000Z', '2020-01-01T09:00:00.000Z');
	await createActivityViaApi(page, seedProjectId, '2020-01-01T08:00:00.000Z', '2020-01-01T08:30:00.000Z');

	// Start the timer for real — Open_Mode's anchor, with nothing described yet,
	// is the running session's own start.
	await page.goto('/');
	const startedAt = new Date();
	await page.getByRole('button', { name: 'Spustit timer' }).click();
	await expect(page.getByRole('button', { name: 'Zastavit timer' })).toBeVisible();
	// A real gap for the anchor to span, and long enough to clear
	// MIN_INTERVAL_SECONDS (60s, per .env) — a shorter one gets discarded
	// entirely and NOTHING_TO_LOG disables the pill instead.
	await page.waitForTimeout(65000);
	await page.reload();

	const pill = page.locator('.quick-log__pill').first();
	await expect(pill).toBeVisible();
	await expect(pill).toBeEnabled();
	await pill.click();
	const quickLogClickedAt = new Date();
	// Stop the session right away — it keeps accruing Tracked_Time every second
	// it stays open, which would otherwise show up as fresh Uncovered_Time past
	// the point Quick_Log just described and make "uncovered reached zero" a
	// moving target. The write's own effect (rather than the pill's transient
	// "Uloženo" toast, which a slow round trip can outlast before an assertion
	// gets a chance to see it) is the reliable signal that it landed.
	await page.getByRole('button', { name: 'Zastavit timer' }).click();
	await expect(page.getByRole('button', { name: 'Spustit timer' })).toBeVisible();
	await expect
		.poll(
			async () => {
				const res = await page.request.get(`/api/days/${quickLogClickedAt.toISOString().slice(0, 10)}`);
				const body = (await res.json()) as { totals: { uncoveredSeconds: number } };
				return body.totals.uncoveredSeconds;
			},
			{ timeout: 10000 }
		)
		.toBeLessThanOrEqual(5);

	// Start a second session, replicating the identical shape — an
	// Open_Session with nothing described yet — for the Activity_Dialog side.
	await page.getByRole('button', { name: 'Spustit timer' }).click();
	const secondStartedAt = new Date();
	await page.waitForTimeout(65000);

	// Quick_Log's own "Otevřít dialog" fallback link opens ActivityDialog
	// prefilled with the same suggested project; switch to its Open_Mode
	// ("Od posledního") and save through the real dialog end to end.
	await page.getByRole('button', { name: 'Otevřít dialog' }).click();
	const dialog = page.getByRole('dialog', { name: 'Přidat úkol' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('radio', { name: 'Od posledního' }).click();
	await page.waitForTimeout(700);
	await dialog.getByRole('button', { name: 'Uložit úkol', exact: true }).click();
	const confirmButton = dialog.getByRole('button', { name: 'Potvrdit a uložit' });
	if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
		await confirmButton.click();
	}
	await expect(dialog).toBeHidden();
	const openModeSubmittedAt = new Date();

	// No direct POST response to read from anymore (the write now goes through
	// the real dialog) — verified via the day's stored data instead, matching
	// it back to this write by how close its segment's start is to the second
	// session's own start (the seed entry and the Quick_Log entry both predate
	// it by design, so proximity alone disambiguates).
	const today = secondStartedAt.toISOString().slice(0, 10);
	const dayRes2 = await page.request.get(`/api/days/${today}`);
	const dayBody2 = (await dayRes2.json()) as {
		entries: { segments: { startedAt: string; endedAt: string }[] }[];
	};
	const openModeEntry = dayBody2.entries.find(
		(e) =>
			e.segments.length === 1 &&
			Math.abs(new Date(e.segments[0].startedAt).getTime() - secondStartedAt.getTime()) < 10000
	);
	expect(openModeEntry).toBeDefined();

	// Both produce exactly one segment, starting at their session's own start and
	// ending at (approximately) the moment of submission — the same interval
	// shape through both entry points.
	const openModeStart = new Date(openModeEntry!.segments[0].startedAt);
	const openModeEnd = new Date(openModeEntry!.segments[0].endedAt);
	expect(Math.abs(openModeStart.getTime() - secondStartedAt.getTime())).toBeLessThan(5000);
	expect(Math.abs(openModeEnd.getTime() - openModeSubmittedAt.getTime())).toBeLessThan(5000);

	// Cross-check the Quick_Log write the same way, via the day's stored data.
	const dayIso = startedAt.toISOString().slice(0, 10);
	const dayRes = await page.request.get(`/api/days/${dayIso}`);
	const dayBody = (await dayRes.json()) as {
		entries: { segments: { startedAt: string; endedAt: string }[] }[];
	};
	const quickLogEntry = dayBody.entries.find((e) => e.segments.length === 1);
	expect(quickLogEntry).toBeDefined();
	const qlStart = new Date(quickLogEntry!.segments[0].startedAt);
	const qlEnd = new Date(quickLogEntry!.segments[0].endedAt);
	expect(Math.abs(qlStart.getTime() - startedAt.getTime())).toBeLessThan(5000);
	expect(Math.abs(qlEnd.getTime() - quickLogClickedAt.getTime())).toBeLessThan(5000);
});
