/**
 * Task 11.4 (Requirements 1.16, 1.17, 1.19, 1.20, 1.21, 1.22, 2.3, 2.5, 2.6, 2.7,
 * 13.4, 17.5, 17.6, 17.7) — the auth E2E scenario: logout from `Settings_Menu`,
 * the session-expired message appearing only for a browser-issued request (never
 * a plain navigation redirect), and the generic wrong-passphrase message.
 */
import {
	test,
	expect,
	login,
	createProject,
	seedNonSystemThemeCookie,
	seedLocaleCookie,
	E2E_PASSPHRASE
} from './fixtures';

test('logging out via a direct POST /logout lands on the login page', async ({ page }) => {
	// Exercises the `/logout` action directly, independent of the UI control that
	// submits to it (that path is covered separately below) — isolates the
	// session-ending behaviour this task is actually about (landing on login, no
	// authenticated view state left) from whatever the Settings_Menu button does.
	await login(page);
	await page.goto('/');
	const res = await page.request.post('/logout', {
		form: {},
		headers: { Origin: 'http://localhost:4173' }
	});
	expect(res.status(), await res.text()).toBeLessThan(400);
	await page.goto('/');
	await page.waitForURL(/\/login/);
	await expect(page.getByRole('button', { name: 'Odemknout' })).toBeVisible();
});

test('clicking "Odhlásit se" ends the session and lands on the login page', async ({ page }) => {
	// Formerly documented as "does nothing" (see .agents/ISSUES.md, "Logging out
	// does nothing — the form is removed from the DOM before its own submit
	// completes"): SettingsMenu's logout form used to set `open = false`
	// synchronously in its own `onsubmit` handler, unmounting the form mid-submit
	// and cancelling the native POST. Fixed by deferring that to a macrotask
	// (`handleLogoutSubmit()` in SettingsMenu.svelte) so the browser's own submit
	// dispatch completes first — verified live (this test, run in isolation,
	// confirmed the button now genuinely navigates to /login instead of silently
	// doing nothing).
	await login(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Otevřít nastavení' }).click();
	await page.getByRole('button', { name: 'Odhlásit se' }).click();
	await page.waitForURL(/\/login/);
	await expect(page.getByRole('button', { name: 'Odemknout' })).toBeVisible();

	// The session actually ended server-side, not merely a client-side
	// navigation: a fresh request for a protected page still redirects to
	// /login rather than rendering it from a lingering cookie.
	await page.goto('/');
	await page.waitForURL(/\/login/);
});

test('a plain navigation redirect (no session) shows no session-expired message', async ({
	page,
	context
}) => {
	await seedNonSystemThemeCookie(context);
	await seedLocaleCookie(context);
	await page.goto('/day/2024-01-15');
	await page.waitForURL(/\/login/);
	expect(page.url()).not.toContain('reason=session_expired');
	await expect(page.getByText('Přihlášení vypršelo')).toHaveCount(0);
});

test('a browser-issued request after the session expires redirects with the session-expired message', async ({
	page,
	context
}) => {
	await login(page);
	await createProject(page, 'Anything');
	await page.goto('/day/2024-01-19');

	// The session ends (server-side or client-side, same observable effect here):
	// clear the cookie directly, then trigger a browser-issued fetch — the
	// Dry_Run request ActivityDialog fires as soon as its fields compose a valid
	// request (dry-run.ts's own 401 handler is the one seam that adds the
	// session-expired reason). A project must be selected for the request to be
	// considered composable at all (ActivityDialog's own `canPreview` check).
	await context.clearCookies({ name: 'worklog_session' });
	await page.getByRole('button', { name: 'Přidat úkol', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Přidat úkol' });
	await dialog.getByLabel('od').fill('09:00');
	await dialog.getByLabel('do').fill('10:00');
	await dialog.getByLabel('projekt').click();
	await dialog.getByRole('option', { name: 'Anything' }).click();

	await page.waitForURL(/\/login\?next=.*reason=session_expired/, { timeout: 8000 });
	await expect(page.getByText('Přihlášení vypršelo, přihlas se znovu')).toBeVisible();
});

test('a wrong passphrase shows the generic invalid-credentials message', async ({ page, context }) => {
	// One wrong attempt only — login is rate limited per Requirement 2.6/UC-039
	// (confirmed live: two failures in a row from the same client already
	// triggered "Moc pokusů o přihlášení", correct brute-force-protection
	// behaviour, not something this spec should fight by retrying).
	await seedNonSystemThemeCookie(context);
	await seedLocaleCookie(context);
	await page.goto('/login');
	await page.getByLabel('Heslo').fill('definitely-not-the-right-passphrase');
	await page.getByRole('button', { name: 'Odemknout' }).click();
	await expect(page.getByText('Nesprávné heslo.')).toBeVisible();
	// Never anything more specific than the generic message (e.g. no distinction
	// between "no such passphrase" and "wrong passphrase").
	await expect(page.getByText(/neexistuje|no such/i)).toHaveCount(0);

	// The real passphrase still works after the one failed attempt.
	await page.getByLabel('Heslo').fill(E2E_PASSPHRASE);
	await page.getByRole('button', { name: 'Odemknout' }).click();
	await page.waitForURL('/');
});
