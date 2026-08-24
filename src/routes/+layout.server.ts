/**
 * Root layout load — task 1.10 (design.md "Application Shell"; Requirements 1.1–1.25,
 * 14.16, 14.17). The one `+layout.server.ts` in the whole `002` tree, so it is also the
 * one place outside `+page.server.ts`/`+server.ts` files that reads `lib/server/**`
 * directly, per design.md's "Read and Write Paths": a load function calls the store,
 * it does not `fetch` its own `/api` routes.
 *
 * Returns exactly the five things design.md's "What the Server Hands the Interface"
 * table says the browser must never work out for itself (the current Logical_Day and
 * its bounds; the five Health_Endpoint values), plus the viewport-derived density and
 * availablePx (design.md "Timeline Geometry"), the theme cookies `initTheme()` needs to
 * seed the client rune without a flash, and a seed for the Running_Indicator so it
 * never flashes from empty to running on first paint.
 */
import type { LayoutServerLoad } from './$types';
import type { CurrentSessionResponse } from '$lib/contracts/responses';
import type { Theme } from '$lib/theme/theme.svelte';
import { getConfig } from '$lib/server/core/config';
import { withReadTx } from '$lib/server/store/tx';
import { currentOpenSession } from '$lib/server/store/work-sessions';

export type Density = 'desktop' | 'mobile';

// design.md "Timeline Geometry": availablePx = viewport height − shell − heading − padding,
// e.g. 900 − 84 (shell) − 56 (heading) − 48 (padding) = 712 for the 1440×900 default.
// `DayCollapsed`'s 88px top bar is documented elsewhere as a drawing slip against the
// shell's one real height (84 "on every page") — the general shell height is used here
// rather than a per-page override, per this task's own instructions.
const SHELL_HEIGHT_PX = 84;
const PAGE_HEADING_HEIGHT_PX = 56;
const PAGE_PADDING_PX = 48;

const DEFAULT_VIEWPORT = { width: 1440, height: 900 } as const;
const DESKTOP_MIN_WIDTH_PX = 768;

const VIEWPORT_COOKIE_RE = /^(\d+)x(\d+)$/;

/** Resolves `density`/`availablePx` from the `worklog_viewport` cookie, defaulting to
 * 1440×900 (desktop, availablePx = 712) when it is absent or malformed. */
function resolveViewport(raw: string | undefined): { density: Density; availablePx: number } {
	const match = raw !== undefined ? VIEWPORT_COOKIE_RE.exec(raw) : null;
	const width = match ? Number(match[1]) : DEFAULT_VIEWPORT.width;
	const height = match ? Number(match[2]) : DEFAULT_VIEWPORT.height;

	const density: Density = width >= DESKTOP_MIN_WIDTH_PX ? 'desktop' : 'mobile';
	const availablePx = height - SHELL_HEIGHT_PX - PAGE_HEADING_HEIGHT_PX - PAGE_PADDING_PX;

	return { density, availablePx };
}

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const config = getConfig();
	const { density, availablePx } = resolveViewport(cookies.get('worklog_viewport'));

	// Seeds the Running_Indicator without an extra client round trip on first paint —
	// same read `GET /api/sessions/current` performs, called through the store directly
	// (design.md "Read and Write Paths"). Guarded: Requirement 1.14 puts the
	// SERVICE_UNAVAILABLE-to-offline-page redirect on each PAGE's own load, which this
	// root layout must not pre-empt by throwing first on a transient database hiccup —
	// it degrades to "no open session known yet" instead, corrected by the client's own
	// `visibilitychange` read once the server recovers.
	const now = new Date();
	let currentSession: CurrentSessionResponse;
	try {
		const openSession = await withReadTx((tx) => currentOpenSession(tx));
		currentSession = {
			session: openSession,
			elapsedSeconds:
				openSession === null
					? 0
					: Math.round((now.getTime() - openSession.startedAt.getTime()) / 1000),
			stale: openSession?.stale ?? false
		};
	} catch {
		currentSession = { session: null, elapsedSeconds: 0, stale: false };
	}

	// `locals.theme` carries only the preference (never the resolved render value —
	// see hooks.server.ts's own note on `handleSecurityHeaders`); the resolved cookie is
	// read directly here, the only other place that value is ever needed.
	const themeResolvedCookie = cookies.get('worklog_theme_resolved');
	const themeResolved: Theme | null =
		themeResolvedCookie === 'light' || themeResolvedCookie === 'dark' ? themeResolvedCookie : null;

	return {
		today: locals.today,
		locale: locals.locale,
		themePreference: locals.theme,
		themeResolved,
		density,
		availablePx,
		serverConfig: {
			timezone: config.timezone,
			dayStartHour: config.dayStartHour,
			gaugeStart: config.gaugeStart,
			gaugeEnd: config.gaugeEnd,
			eveningHour: config.eveningHour,
			maxOpenSessionHours: config.maxOpenSessionHours
		},
		currentSession
	};
};
