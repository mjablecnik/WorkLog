<script lang="ts">
	/**
	 * The application shell — task 1.10 (design.md "Application Shell";
	 * Requirements 1.1–1.25, 14.16, 14.17). Assembles the generic pieces task 1.3
	 * built (`Shell`/`Topbar`/`BottomNav`/`Fab`) and task 1.8's `SettingsMenu` into
	 * the real root layout, wires the theme/locale runes from `+layout.server.ts`'s
	 * server-resolved values, and owns the two things unique to the shell itself:
	 * the `Running_Indicator` (its own small elapsed-seconds tracker, built from
	 * `createElapsed` exactly as `src/modules/timer/elapsed.svelte.ts`'s own doc
	 * comment anticipates) and the Logical_Day rollover schedule.
	 *
	 * `initTheme()`/`initLocale()` are called synchronously here at the top of the
	 * script — not inside `onMount`/`$effect`. Both those hooks are client-only and
	 * never run during server rendering, but Requirement 1.23/17.10 require the
	 * FIRST response bytes to already carry the right language (not merely the
	 * right `<html lang>` attribute, which `001`'s hook stamps independently of
	 * this rune): every `m.*()` call anywhere in the tree reads the locale through
	 * this module's `overwriteGetLocale()` override, so the rune has to be seeded
	 * before any descendant component's script runs. A plain top-level statement
	 * in this component's `<script>` runs during SSR (once per request, before
	 * `{@render children()}` is evaluated) and once on the client at hydration —
	 * which is "call once, from the root layout" in both environments. Both
	 * functions already guard their `window`/`document` touches internally, so
	 * calling them unconditionally here is safe server-side.
	 */
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import type { LayoutData } from './$types';
	import type { Density } from './+layout.server';
	import type { CurrentSessionResponse } from '$lib/contracts/responses';
	import Shell from '$lib/ui/layout/Shell.svelte';
	import Topbar from '$lib/ui/layout/Topbar.svelte';
	import BottomNav from '$lib/ui/layout/BottomNav.svelte';
	import SettingsMenu from '$lib/ui/layout/SettingsMenu.svelte';
	import ToastContainer from '$lib/ui/overlays/ToastContainer.svelte';
	import type { IconName } from '$lib/ui/elements/Icon.svelte';
	import { initTheme } from '$lib/theme/theme.svelte';
	import { initLocale } from '$lib/core/i18n';
	import { createElapsed, scheduleLogicalDayRollover } from '$modules/timer/elapsed.svelte';
	import { formatClock } from '$lib/viz/format';

	interface Props {
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	// `data` is a reactive prop; every read below is a deliberate ONE-TIME snapshot of
	// its initial value (the seed for a rune/store that owns its own reactivity from
	// then on) rather than something meant to track later `data` changes — `untrack()`
	// says so explicitly instead of leaving it to look like an oversight.
	untrack(() => {
		initTheme(data.themePreference, data.themeResolved);
		initLocale(data.locale);
	});

	type NavTarget = { href: string; label: string; icon: IconName; current: boolean };

	const navTargets = $derived.by((): NavTarget[] => {
		const path = page.url.pathname;
		return [
			{ href: '/', label: m.nav_timer(), icon: 'timer', current: path === '/' },
			{
				href: `/day/${data.today.date}`,
				label: m.nav_day(),
				icon: 'day',
				current: path.startsWith('/day')
			},
			{ href: '/projects', label: m.nav_projects(), icon: 'projects', current: path.startsWith('/projects') },
			{ href: '/stats', label: m.nav_stats(), icon: 'stats', current: path.startsWith('/stats') }
		];
	});

	const isTimerPage = $derived(page.url.pathname === '/');

	// Login, logout and offline are the three routes design.md's "Login, error and
	// offline pages" describes with their own minimal centred "page shell" — not the
	// Application Shell. Nav links an unauthenticated visitor cannot use, and a
	// Settings_Menu that offers logging out, have no business on the login page; the
	// offline page shares the pattern deliberately (a full nav bar over "the server
	// isn't answering" invites clicking straight into more failures). `+error.svelte`
	// needs no such check — SvelteKit already renders it without this layout whenever
	// the root `load` above never ran (an unmatched route, or this layout's own load
	// failing outright).
	const isBareShellPage = $derived(
		page.url.pathname === '/login' || page.url.pathname === '/logout' || page.url.pathname === '/offline'
	);

	// The Settings_Menu's own popover-vs-sheet, modal-vs-not behaviour must track the
	// REAL rendered breakpoint, not the server's viewport-cookie snapshot (which exists
	// for the Day page's server-rendered timeline geometry, not for driving the shell).
	// Seeded from the server value to avoid a hydration mismatch, corrected live by a
	// `matchMedia` listener — the same pattern `theme.svelte.ts` uses for
	// `prefers-color-scheme`.
	let density = $state<Density>(untrack(() => data.density));

	$effect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
		const mql = window.matchMedia('(min-width: 768px)');
		const update = () => {
			density = mql.matches ? 'desktop' : 'mobile';
		};
		update();
		mql.addEventListener('change', update);
		return () => mql.removeEventListener('change', update);
	});

	// The Running_Indicator's own elapsed-seconds tracker (design.md "Application
	// Shell"; elapsed.svelte.ts's own doc comment: "exactly 'the elapsed seconds of
	// the open session, ticking locally, corrected from the server'"). Seeded from
	// the root layout's server-side read so it never flashes from empty to running.
	let hasOpenSession = $state(untrack(() => data.currentSession.session !== null));
	const runningIndicatorElapsed = createElapsed({
		openedAt: untrack(() => data.currentSession.session?.startedAt ?? null)
	});
	untrack(() => runningIndicatorElapsed.sync(data.currentSession));

	const showRunningIndicator = $derived(!isTimerPage && hasOpenSession);

	/** Requirement 3.10/3.12: on tab focus, the elapsed store is corrected from a fresh
	 * server read (the one legitimate mid-page `fetch`, per design.md's "Read and Write
	 * Paths" table) and the page data is invalidated in the same breath, so the two
	 * never drift — one lagging the other. */
	async function handleVisibilityChange(): Promise<void> {
		if (document.visibilityState !== 'visible') return;
		try {
			const res = await fetch('/api/sessions/current');
			if (res.ok) {
				const current = (await res.json()) as CurrentSessionResponse;
				runningIndicatorElapsed.sync(current);
				hasOpenSession = current.session !== null;
			}
		} catch {
			// Transient network failure — the next visibilitychange retries; nothing to
			// surface here, the indicator just keeps ticking from its last known state.
		}
		await invalidateAll();
	}

	// Requirement 1.25/3.18: the Logical_Day rolls over while a page stays open. The
	// browser never computes the boundary itself — it only schedules against the
	// instant the server already resolved. Re-schedules whenever `data.today` changes
	// (including the invalidation the rollover itself triggers, for the day after).
	$effect(() => {
		return scheduleLogicalDayRollover(data.today.bounds.end, () => {
			void invalidateAll();
		});
	});

	// Requirement 1.13: state which zone displayed times are in when the device
	// disagrees with the server. Computed client-only (progressive enhancement, not
	// the theme's "one permitted flash" — a missing notice for one frame is harmless).
	let showTimezoneNotice = $state(false);

	$effect(() => {
		if (typeof Intl === 'undefined') return;
		try {
			const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
			showTimezoneNotice = deviceZone !== data.serverConfig.timezone;
		} catch {
			showTimezoneNotice = false;
		}
	});

	// Requirement 14.17: measure the real viewport once on mount and rewrite the
	// `worklog_viewport` cookie only if it differs from what the server assumed —
	// a returning desktop user with an accurate cookie sees no rewrite at all.
	//
	// design.md is explicit that a mismatch does two things, not one: "the client
	// measures the real viewport, and only if it differs writes the cookie AND LAYS
	// OUT AGAIN." Writing the cookie alone only affects the *next* navigation —
	// `+layout.server.ts`'s `resolveViewport()` already ran for this one, off
	// whatever the cookie held on the way in, so the current page keeps rendering at
	// the wrong density until something re-runs that load. Confirmed live: a stale
	// desktop-sized `worklog_viewport` cookie reused at a 320px viewport (exactly
	// what `tests/e2e/a11y.spec.ts`'s `storageState`-reuse pattern produces) left the
	// timer page's `DayGauge` rendered at its 340px desktop box on a 320px viewport
	// — a real, reproducible 10px overflow (Requirement 14.1) — until the missing
	// `invalidateAll()` below was added.
	onMount(() => {
		const measured = `${window.innerWidth}x${window.innerHeight}`;
		const existing = document.cookie
			.split('; ')
			.find((row) => row.startsWith('worklog_viewport='))
			?.slice('worklog_viewport='.length);
		if (existing === measured) return;
		document.cookie = `worklog_viewport=${measured}; path=/; max-age=31536000; samesite=lax`;
		void invalidateAll();
	});
</script>

<svelte:document onvisibilitychange={handleVisibilityChange} />

{#if isBareShellPage}
	{@render children()}
{:else}
	<Shell>
		{#snippet header()}
			<Topbar brand={m.nav_brand()} brandHref="/" navItems={navTargets}>
				{#snippet right()}
					{#if showRunningIndicator}
						<div
							class="running-indicator"
							aria-label={m.shell_running_label({
								elapsed: formatClock(runningIndicatorElapsed.runningSeconds)
							})}
						>
							<span class="running-indicator__dot" aria-hidden="true"></span>
							<span class="running-indicator__elapsed" aria-hidden="true">
								{formatClock(runningIndicatorElapsed.runningSeconds)}
							</span>
						</div>
					{/if}
					<SettingsMenu {density} />
				{/snippet}
			</Topbar>
		{/snippet}

		{#snippet bottomNav()}
			<BottomNav items={navTargets} ariaLabel={m.nav_brand()} />
		{/snippet}

		{#if showTimezoneNotice}
			<p class="timezone-notice">{m.shell_timezone_notice({ timeZone: data.serverConfig.timezone })}</p>
		{/if}

		{@render children()}
	</Shell>
{/if}

<ToastContainer />

<style>
	.running-indicator {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.running-indicator__dot {
		width: 6px;
		height: 6px;
		border-radius: 9999px;
		background-color: var(--accent);
		flex-shrink: 0;
	}

	.running-indicator__elapsed {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
	}

	@media (min-width: 768px) {
		.running-indicator__elapsed {
			font-size: 13px;
		}
	}

	.timezone-notice {
		margin: 0;
		padding: 8px 0 0;
		font-size: 12px;
		text-align: center;
		color: var(--text-faint);
	}
</style>
