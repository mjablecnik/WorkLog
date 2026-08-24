/**
 * The login form contract (Requirement 11.25). Owned by this specification because
 * the form action is; `002-worklog-ui` owns the matching `+page.svelte` and renders
 * against exactly the field/query names documented on `loginSchema`
 * (`src/lib/contracts/schemas.ts`).
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { loginSchema } from '$lib/contracts/schemas';
import {
	beginBrowserSessionCookie,
	resolveSafeRedirect,
	verifyLoginPassphrase,
	SESSION_COOKIE
} from '$lib/server/services/auth';
import { withTx } from '$lib/server/store/tx';
import { beginBrowserSession } from '$lib/server/store/auth-sessions';

export const load: PageServerLoad = async ({ url }) => {
	return {
		next: url.searchParams.get('next'),
		reason: url.searchParams.get('reason')
	};
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const parsed = loginSchema.safeParse({
			passphrase: formData.get('passphrase') ?? '',
			next: formData.get('next') || undefined
		});

		// Requirement 11.12: a wrong OR an empty passphrase get the same generic key.
		if (!parsed.success) {
			return fail(400, { messageKey: 'errors_login_failed' });
		}

		const ok = await verifyLoginPassphrase(parsed.data.passphrase);
		if (!ok) {
			return fail(400, { messageKey: 'errors_login_failed' });
		}

		const { token, tokenHash, expiresAt, cookieOptions } = beginBrowserSessionCookie();
		await withTx((tx) => beginBrowserSession(tx, tokenHash, expiresAt));

		event.cookies.set(SESSION_COOKIE, token, cookieOptions);

		// The field wins over the query string when both are present: the field is
		// what the submitted form carried.
		const target = resolveSafeRedirect(parsed.data.next ?? event.url.searchParams.get('next'));
		redirect(303, target);
	}
};
