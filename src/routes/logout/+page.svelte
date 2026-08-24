<script lang="ts">
	/**
	 * The no-JavaScript logout fallback — task 1.11 (Requirement 2.5;
	 * design.md "Login, error and offline pages" / Project Structure: "the
	 * confirmation view for a no-JavaScript logout"). `001` owns
	 * `logout/+page.server.ts`, which only exports a `default` action (no
	 * `load`) that deletes the stored session and unconditionally
	 * `redirect(303, '/login')`s.
	 *
	 * In the normal, JS-enabled flow this route is never actually rendered:
	 * `SettingsMenu`'s own form posts straight to `/logout` and the action's
	 * redirect lands the browser on `/login` without a GET to this page ever
	 * happening — that form is, per design.md, "the only logout control in
	 * the interface." This page exists for the case a GET reaches `/logout`
	 * directly (a bookmark, a typed URL) with no action having run yet: a
	 * minimal confirmation that posts the same action, matching the shared
	 * bare "page shell" of the login, error and offline pages.
	 */
	import * as m from '$lib/paraglide/messages';
	import Button from '$lib/ui/elements/Button.svelte';
</script>

<svelte:head>
	<title>{m.settings_logout()}</title>
</svelte:head>

<div class="page-shell">
	<div class="page-shell__card">
		<h1 class="page-shell__heading">{m.settings_logout()}</h1>

		<form method="POST" class="logout-form">
			<Button type="submit" size="lg">{m.common_confirm()}</Button>
		</form>
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

	.logout-form {
		display: flex;
		width: 100%;
	}
</style>
