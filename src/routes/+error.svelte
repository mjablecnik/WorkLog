<script lang="ts">
	/**
	 * The unknown-route / unhandled-error page — task 1.10 (Requirement 1.10).
	 * SvelteKit renders this standalone, without the Application Shell, whenever no
	 * route matches at all or an ancestor `load` throws before the shell itself can
	 * render — so it carries its own minimal "page shell", the one design.md's
	 * "Login, error and offline pages" section describes: a centred column at
	 * `max-width: 420`, `gap: 16`, a 20/500 heading, a 14 `--text-dim` line, then the
	 * single action as a filled accent pill. No error detail is ever shown (message,
	 * status, stack) — Requirement 1.10 asks only for a link back to the timer page,
	 * and the security standard forbids leaking internals to the page anyway.
	 */
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.error_page_title()}</title>
</svelte:head>

<div class="page-shell">
	<div class="page-shell__card">
		<h1 class="page-shell__heading">{m.error_page_title()}</h1>
		<p class="page-shell__body">{m.error_page_body()}</p>
		<a href={resolve('/')} class="page-shell__primary">{m.error_page_home()}</a>
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

	.page-shell__primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 42px;
		padding: 0 20px;
		border-radius: 9999px;
		background-color: var(--accent);
		color: var(--ink-on-accent);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: background-color var(--dur-hover, 200ms) var(--ease-standard, ease);
	}

	.page-shell__primary:hover {
		background-color: var(--accent-hover);
	}

	.page-shell__primary:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}
</style>
