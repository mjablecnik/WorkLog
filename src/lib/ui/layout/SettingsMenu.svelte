<script lang="ts">
	/**
	 * Task 1.8 (design.md "10a. Settings Menu" / "Application Shell → Settings").
	 * One component, both presentations: an anchored popover under the chip on
	 * desktop, a modal bottom sheet on mobile. Owns its own trigger — the round
	 * gear chip — and its own `open` state; there is nothing to persist about it
	 * (design.md § 10a).
	 *
	 * Desktop anchoring is pure CSS, not measured. The trigger and the popover
	 * share one `position: relative` wrapper, so the popover's `position: absolute;
	 * top: 100%; right: 0` sits directly under the chip regardless of where the
	 * caller places the wrapper in the top bar — no `getBoundingClientRect`, no
	 * inline `style.setProperty` (forbidden by the CSP note in design.md
	 * "Applying Tokens Without Inline Styles": a nonce does not cover `style=`).
	 * Since the chip already sits at the top bar's right padding (Topbar.svelte),
	 * this reproduces "anchored under the chip at the page's right padding" for
	 * free, without needing to know that padding's value here.
	 *
	 * Mobile modality reuses `modal-stack.ts` directly — its own doc comment
	 * already names "the mobile Settings_Menu sheet" as one of the surfaces it
	 * was built for. The sheet is portalled to `document.body` (same `portal`
	 * action as `Modal.svelte`) so the stack's inert sweep, which skips only the
	 * portal node itself, never inerts the sheet along with the rest of the page.
	 * The desktop popover is explicitly NOT modal (Requirement 14.24 lists only
	 * write dialogs, confirmations and "the mobile Settings_Menu sheet") — it
	 * never calls `pushModal`, sets no `inert`, locks no scroll.
	 */
	import Icon from '../elements/Icon.svelte';
	import * as m from '$lib/paraglide/messages';
	import { setThemePreference, theme, type ThemePreference } from '$lib/theme/theme.svelte';
	import { getCurrentLocale, switchLocale, type AppLocale } from '$lib/core/i18n';
	import { pushModal, popModal, isTopModal } from '../overlays/modal-stack';

	interface Props {
		density: 'desktop' | 'mobile';
	}

	let { density }: Props = $props();

	let open = $state(false);
	let chipEl: HTMLButtonElement | undefined = $state();
	let panelEl: HTMLElement | undefined = $state();
	let portalEl: HTMLElement | undefined = $state();

	const modalId = Symbol('settings-menu');
	const instanceId = $props.id();
	const panelId = `${instanceId}-settings-panel`;
	const themeLabelId = `${instanceId}-settings-theme-label`;
	const localeLabelId = `${instanceId}-settings-locale-label`;

	const THEME_OPTIONS: { value: ThemePreference; label: () => string }[] = [
		{ value: 'system', label: m.settings_theme_system },
		{ value: 'light', label: m.settings_theme_light },
		{ value: 'dark', label: m.settings_theme_dark }
	];

	const LOCALE_OPTIONS: { value: AppLocale; label: () => string }[] = [
		{ value: 'cs', label: m.settings_language_cs },
		{ value: 'en', label: m.settings_language_en }
	];

	const FOCUSABLE_SELECTOR = 'button:not([disabled]), [role="radio"]';

	function focusableElements(): HTMLElement[] {
		if (!panelEl) return [];
		return Array.from(panelEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
	}

	function openMenu(): void {
		open = true;
	}

	/** The general close path — every close except a logout submit returns focus
	 * to the chip (Requirement 1.21). */
	function closeMenu(): void {
		if (!open) return;
		open = false;
		chipEl?.focus();
	}

	function toggleMenu(): void {
		if (open) closeMenu();
		else openMenu();
	}

	function handleThemeSelect(next: ThemePreference): void {
		setThemePreference(next);
	}

	function handleLocaleSelect(next: AppLocale): void {
		switchLocale(next);
	}

	/** The logout row closes the menu and lets the form submission navigate away
	 * on its own — no focus return, since there is nothing left to return focus
	 * to once the document leaves for `/login` (task instructions, design.md's
	 * "returning focus to the chip" is the general rule, not this exception).
	 *
	 * `open = false` is deferred to a macrotask (`setTimeout`), never applied
	 * synchronously inside this handler. The form's `{#if open}` block unmounts
	 * the form the instant `open` becomes `false`; a plain `method="POST"` form
	 * with no `use:enhance` submits natively, and the browser's own submit
	 * algorithm checks the form is still connected to the document AFTER this
	 * synchronous handler returns but still within the same dispatch — closing
	 * synchronously here cancels the submission outright before any request is
	 * ever sent (confirmed live: a real browser logs "Form submission canceled
	 * because the form is not connected", task 11's E2E pass). A macrotask runs
	 * strictly after the browser has already begun the real submission/
	 * navigation, so the menu still closes (moot in practice — the whole page is
	 * about to leave for `/login` — but harmless) without racing the form out
	 * from under its own submit. */
	function handleLogoutSubmit(): void {
		setTimeout(() => {
			open = false;
		}, 0);
	}

	/** Roving-tabindex arrow navigation shared by both radiogroups: the group is
	 * found from the DOM rather than passed in, so one handler serves both the
	 * Theme_Switcher and the Locale_Switcher (Requirement 14.18). */
	function handleSegKeydown(event: KeyboardEvent): void {
		const key = event.key;
		if (key !== 'ArrowRight' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowUp') {
			return;
		}
		const current = event.currentTarget as HTMLElement;
		const group = current.closest('[role="radiogroup"]');
		if (!group) return;
		const items = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
		const index = items.indexOf(current);
		if (index === -1) return;
		event.preventDefault();
		const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
		const nextItem = items[(index + delta + items.length) % items.length];
		nextItem.focus();
		nextItem.click();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) return;
		// Only the top-most modal surface reacts — mirrors Modal.svelte's guard.
		// The desktop popover is never on the stack, so it always passes.
		if (density === 'mobile' && !isTopModal(modalId)) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu();
			return;
		}

		if (density !== 'mobile' || event.key !== 'Tab') return;
		const focusable = focusableElements();
		if (focusable.length === 0) {
			event.preventDefault();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	/** Desktop-only outside-activation detection (Requirement 1.21 / 14.23): the
	 * popover has no scrim, so a document-level listener is what "outside"
	 * means. Mobile's "outside" is exactly the scrim — it covers the full
	 * viewport beneath the sheet — so `handleScrimActivate` below is that
	 * density's whole answer and this listener is never attached for it. */
	function handleDocumentPointerdown(event: PointerEvent): void {
		if (!open) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (panelEl?.contains(target)) return;
		if (chipEl?.contains(target)) return;
		closeMenu();
	}

	function handleScrimActivate(): void {
		if (!isTopModal(modalId)) return;
		closeMenu();
	}

	/** Moves the sheet's portal node to `document.body`, exactly like
	 * `Modal.svelte`'s own `portal` action — required so `pushModal`'s inert
	 * sweep (which excludes only its `portalNode` argument) never inerts the
	 * sheet along with the rest of the page. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy(): void {
				node.remove();
			}
		};
	}

	$effect(() => {
		if (density === 'mobile' || !open) return;
		document.addEventListener('pointerdown', handleDocumentPointerdown, true);
		return () => document.removeEventListener('pointerdown', handleDocumentPointerdown, true);
	});

	// Mobile: join the shared modal stack (scroll lock + inert on 0 → 1,
	// restored on 1 → 0) and move focus into the sheet.
	$effect(() => {
		if (density !== 'mobile' || !open || !portalEl) return;
		pushModal(modalId, portalEl);
		const target = focusableElements()[0] ?? null;
		target?.focus();
		return () => popModal(modalId);
	});

	// Desktop: not modal, just move focus into the popover.
	$effect(() => {
		if (density === 'mobile' || !open) return;
		const target = focusableElements()[0] ?? null;
		target?.focus();
	});
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

<div class="settings-menu settings-menu--{density}">
	<button
		bind:this={chipEl}
		type="button"
		class="settings-menu__chip"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-controls={open ? panelId : undefined}
		aria-label={m.aria_open_settings()}
		onclick={toggleMenu}
	>
		<Icon name="settings" size={16} />
	</button>

	{#if open && density === 'desktop'}
		<div
			bind:this={panelEl}
			id={panelId}
			class="settings-menu__panel settings-menu__panel--desktop"
			role="dialog"
			aria-label={m.shell_settings_open()}
		>
			{@render menuContent()}
		</div>
	{/if}

	{#if open && density === 'mobile'}
		<div use:portal bind:this={portalEl}>
			<!-- The scrim is a click target only — Escape (handled on the window
			     above) is its keyboard equivalent, exactly like Modal.svelte. `role="presentation"`
			     already exempts this element from the click/key-events a11y rule. -->
			<div
				class="settings-menu__scrim"
				onclick={handleScrimActivate}
				role="presentation"
			></div>
			<div
				bind:this={panelEl}
				id={panelId}
				class="settings-menu__panel settings-menu__panel--mobile"
				role="dialog"
				aria-modal="true"
				aria-label={m.shell_settings_open()}
				tabindex="-1"
			>
				<div class="settings-menu__grabber" aria-hidden="true"></div>
				{@render menuContent()}
			</div>
		</div>
	{/if}
</div>

{#snippet menuContent()}
	<div class="settings-menu__block">
		<span id={themeLabelId} class="lbl">{m.settings_theme_label()}</span>
		<div class="seg-group" role="radiogroup" aria-labelledby={themeLabelId}>
			{#each THEME_OPTIONS as opt (opt.value)}
				{@const active = opt.value === theme.preference}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					tabindex={active ? 0 : -1}
					class="seg-item"
					class:seg-item--active={active}
					onclick={() => handleThemeSelect(opt.value)}
					onkeydown={handleSegKeydown}
				>
					{opt.label()}
				</button>
			{/each}
		</div>
	</div>

	<div class="settings-menu__block">
		<span id={localeLabelId} class="lbl">{m.settings_language_label()}</span>
		<div class="seg-group" role="radiogroup" aria-labelledby={localeLabelId}>
			{#each LOCALE_OPTIONS as opt (opt.value)}
				{@const active = opt.value === getCurrentLocale()}
				<button
					type="button"
					role="radio"
					aria-checked={active}
					tabindex={active ? 0 : -1}
					class="seg-item"
					class:seg-item--active={active}
					onclick={() => handleLocaleSelect(opt.value)}
					onkeydown={handleSegKeydown}
				>
					{opt.label()}
				</button>
			{/each}
		</div>
	</div>

	<hr class="settings-menu__divider" />

	<form method="POST" action="/logout" class="settings-menu__logout-form" onsubmit={handleLogoutSubmit}>
		<button type="submit" class="settings-menu__logout">
			<Icon name="logout" size={density === 'mobile' ? 17 : 15} />
			<span>{m.settings_logout()}</span>
		</button>
	</form>
{/snippet}

<style>
	.settings-menu {
		position: relative;
		display: inline-flex;
	}

	/* --------------------------------------------------------------------
	 * Trigger chip
	 * ------------------------------------------------------------------ */
	.settings-menu__chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: none;
		border-radius: var(--radius-9999);
		background: var(--chip);
		color: var(--text);
		cursor: pointer;
		transition: background-color var(--dur-hover) var(--ease-standard);
	}
	.settings-menu--mobile .settings-menu__chip {
		width: 32px;
		height: 32px;
	}
	.settings-menu__chip:hover {
		background: var(--chip-hover);
	}
	.settings-menu__chip:active {
		background: var(--chip-active);
		transform: none;
	}
	.settings-menu__chip:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--bg)),
			0 0 0 4px var(--accent);
	}

	/* --------------------------------------------------------------------
	 * Shared panel content
	 * ------------------------------------------------------------------ */
	.settings-menu__panel {
		display: flex;
		flex-direction: column;
		background: var(--dialog);
		--focus-gap: var(--dialog);
	}

	.settings-menu__panel--desktop {
		position: absolute;
		top: calc(100% + 12px);
		right: 0;
		z-index: 3;
		width: 268px;
		gap: 16px;
		padding: 16px;
		border-radius: var(--radius-14);
		border: 1px solid var(--menu-border);
		box-shadow: var(--menu-shadow);
		animation: settings-menu-in var(--dur-hover) var(--ease-standard);
	}

	.settings-menu__scrim {
		position: fixed;
		inset: 0;
		z-index: 2;
		background: var(--scrim);
		animation: settings-scrim-in var(--dur-panel) var(--ease-standard);
	}

	.settings-menu__panel--mobile {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 3;
		gap: 20px;
		padding: 10px 22px calc(26px + env(safe-area-inset-bottom));
		/* Radius 13 sits outside the closed radii ladder in design.md's "Radii,
		   Heights, Widths" table, but the Settings row table two sections above
		   states it twice, explicitly, for this exact surface — see the task
		   report for the discrepancy. Taken literally since it is the more
		   specific of the two. */
		border-radius: 20px 20px 0 0;
		animation: settings-sheet-in var(--dur-panel) var(--ease-standard);
	}

	.settings-menu__grabber {
		align-self: center;
		width: 38px;
		height: 4px;
		border-radius: var(--radius-9999);
		background: var(--grabber);
	}

	.settings-menu__block {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* --------------------------------------------------------------------
	 * Segmented control (Theme_Switcher / Locale_Switcher)
	 * ------------------------------------------------------------------ */
	.seg-group {
		display: flex;
		gap: 4px;
		padding: 4px;
		border-radius: var(--radius-11);
		background: var(--group);
	}
	.settings-menu--mobile .seg-group {
		border-radius: 13px;
	}

	.seg-item {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 34px;
		border: none;
		border-radius: var(--radius-9);
		background: transparent;
		color: var(--text-dim);
		font-size: 13px;
		font-weight: 400;
		cursor: pointer;
		transition:
			background-color var(--dur-hover) var(--ease-standard),
			color var(--dur-hover) var(--ease-standard);
	}
	.settings-menu--mobile .seg-item {
		height: 44px;
		border-radius: var(--radius-10);
		font-size: 14px;
	}

	.seg-item:hover {
		color: var(--text);
	}
	.seg-item--active {
		background: var(--segment-active);
		color: var(--accent);
		font-weight: 500;
	}
	.seg-item--active:hover {
		color: var(--accent);
	}
	.seg-item:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--dialog)),
			0 0 0 4px var(--accent);
	}

	/* --------------------------------------------------------------------
	 * Divider + logout
	 * ------------------------------------------------------------------ */
	.settings-menu__divider {
		height: 1px;
		margin: 0;
		border: none;
		background: var(--divider);
	}

	.settings-menu__logout-form {
		margin: 0;
	}

	.settings-menu__logout {
		display: flex;
		align-items: center;
		width: 100%;
		gap: 10px;
		height: 34px;
		padding: 0 4px;
		border: none;
		border-radius: var(--radius-9);
		background: transparent;
		color: var(--destructive);
		font-size: 13.5px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color var(--dur-hover) var(--ease-standard);
	}
	.settings-menu--mobile .settings-menu__logout {
		height: 44px;
		gap: 12px;
		font-size: 14.5px;
	}
	.settings-menu__logout:hover {
		background: var(--group);
	}
	.settings-menu__logout:active {
		transform: none;
	}
	.settings-menu__logout:focus-visible {
		outline: none;
		box-shadow:
			0 0 0 2px var(--focus-gap, var(--dialog)),
			0 0 0 4px var(--accent);
	}

	@keyframes settings-menu-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes settings-scrim-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes settings-sheet-in {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
</style>
