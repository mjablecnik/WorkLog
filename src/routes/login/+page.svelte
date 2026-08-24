<script lang="ts">
	/**
	 * The login page — task 1.11 (Requirement 2.1-2.4, 2.7; design.md "Login, error
	 * and offline pages"). `001` owns `login/+page.server.ts`: its `load` resolves
	 * `next`/`reason` from the URL server-side (read from `data` here rather than
	 * re-parsing `$page.url.searchParams`, so SSR and the client never disagree),
	 * and its `default` action validates against `loginSchema` (`.strict()`,
	 * `passphrase` + `next` only) and either `fail(400, { messageKey })` or issues
	 * the redirect itself — this page never navigates on success, `use:enhance`'s
	 * default handling already follows the server's `redirect(303, ...)`, and the
	 * plain-POST fallback (no JS) gets the same real HTTP redirect from the browser.
	 *
	 * Requirement 2.3: `errors_login_failed` is the one generic message shown for
	 * both a wrong and an empty passphrase — nothing here distinguishes them.
	 * Requirement 2.7: the session-expired notice renders only when the load
	 * observed `reason=session_expired`; a bare `Auth_Hook` redirect carries `next`
	 * alone and shows nothing.
	 */
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
	import type { ActionData, PageData } from './$types';
	import FormField from '$lib/ui/forms/FormField.svelte';
	import Input from '$lib/ui/elements/Input.svelte';
	import Button from '$lib/ui/elements/Button.svelte';

	interface Props {
		data: PageData;
		form: ActionData;
	}

	let { data, form }: Props = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>{m.auth_title()}</title>
</svelte:head>

<div class="page-shell">
	<div class="page-shell__card">
		<h1 class="page-shell__heading">{m.auth_title()}</h1>

		{#if data.reason === 'session_expired'}
			<p class="page-shell__body">{m.auth_session_expired()}</p>
		{/if}

		<form
			method="POST"
			class="login-form"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<input type="hidden" name="next" value={data.next ?? ''} />

			<FormField
				label={m.auth_passphrase_label()}
				error={form?.messageKey ? m.errors_login_failed() : undefined}
			>
				{#snippet children({ id, describedBy })}
					<Input
						{id}
						type="password"
						name="passphrase"
						autocomplete="current-password"
						error={Boolean(form?.messageKey)}
						aria-describedby={describedBy}
						class="login-form__passphrase"
					/>
				{/snippet}
			</FormField>

			<Button type="submit" size="lg" loading={submitting}>
				{m.auth_submit()}
			</Button>
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

	.page-shell__body {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: var(--text-dim);
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
		width: 100%;
	}

	@media (max-width: 767px) {
		:global(.login-form__passphrase) {
			min-height: 48px;
		}
	}
</style>
