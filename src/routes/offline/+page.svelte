<script lang="ts">
	/**
	 * The connection-error destination — task 1.10 (Requirement 1.14; design.md
	 * "What reaches /offline"). A page whose own `load` fails with
	 * `SERVICE_UNAVAILABLE` or with no response at all redirects here carrying
	 * `?next=<path>` (that redirect itself is each page's own concern, later
	 * tasks — this file is only the destination). Shares the same minimal "page
	 * shell" as `+error.svelte` and the login page (design.md "Login, error and
	 * offline pages": centred column, `max-width: 420`, `gap: 16`, 20/500 heading,
	 * 14 `--text-dim` body), plus the offline page's own addition: a ghost *retry*
	 * pill beside the primary action, which is the one that actually re-attempts
	 * `next`. The Application Shell is deliberately not rendered around this page
	 * (see the root `+layout.svelte`'s `isBareShellPage` check) — a full nav bar
	 * over a "the server isn't answering" message invites clicking straight into
	 * more failures.
	 */
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';

	const nextPath = $derived(page.url.searchParams.get('next') || '/');
</script>

<svelte:head>
	<title>{m.offline_title()}</title>
</svelte:head>

<div class="page-shell">
	<div class="page-shell__card">
		<h1 class="page-shell__heading">{m.offline_title()}</h1>
		<p class="page-shell__body">{m.offline_body()}</p>
		<div class="page-shell__actions">
			<a href="/" class="page-shell__primary">{m.error_page_home()}</a>
			<a href={nextPath} class="page-shell__ghost">{m.common_retry()}</a>
		</div>
	</div>
</div>

<style>
	.page-shell {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: 24px;
		background-color: var(--bg);
		color: var(--text);
	}

	.page-shell__card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 16px;
		width: 100%;
		max-width: 420px;
	}

	.page-shell__heading {
		margin: 0;
		font-size: 20px;
		font-weight: 500;
		line-height: 1.3;
		color: var(--text);
	}

	.page-shell__body {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: var(--text-dim);
	}

	.page-shell__actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.page-shell__primary,
	.page-shell__ghost {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 42px;
		padding: 0 20px;
		border-radius: 9999px;
		font-size: 14px;
		text-decoration: none;
		cursor: pointer;
		transition: background-color var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.page-shell__primary {
		background-color: var(--accent);
		color: var(--ink-on-accent);
		font-weight: 600;
	}

	.page-shell__primary:hover {
		background-color: var(--accent-hover);
	}

	.page-shell__ghost {
		background-color: var(--chip);
		color: var(--text-dim);
		font-weight: 500;
	}

	.page-shell__ghost:hover {
		background-color: var(--chip-hover);
	}

	.page-shell__primary:focus-visible,
	.page-shell__ghost:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}
</style>
