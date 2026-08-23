/**
 * Logout invalidates the session server-side (Requirement 11.14), not merely the
 * cookie client-side. Owned by this specification; `002-worklog-ui` owns nothing here
 * beyond an optional confirmation UI that posts to this action.
 */
import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { hashSessionToken, SESSION_COOKIE } from '$lib/server/core/auth';
import { withTx } from '$lib/server/store/tx';
import { deleteAuthSession } from '$lib/server/store/auth-sessions';

export const actions: Actions = {
	default: async (event) => {
		const cookieValue = event.cookies.get(SESSION_COOKIE);
		if (cookieValue !== undefined) {
			const tokenHash = hashSessionToken(cookieValue);
			await withTx((tx) => deleteAuthSession(tx, tokenHash));
		}
		event.cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
};
