/**
 * Task 1.14. Component test for `SettingsMenu` (task 1.8). Runs under the
 * `components` Vitest project (jsdom, `@testing-library/svelte`), same setup as
 * `tests/modules/day/components/change-preview.test.ts` — the first `.svelte`
 * -rendering test in the project, whose header comment documents the jsdom wiring
 * (`tests/setup/dom.ts`'s explicit `afterEach(cleanup())`, the `browser` resolve
 * condition in `vitest.config.ts`'s `components` project). Reused here, not
 * reinvented.
 *
 * Paraglide's `getLocale()` defaults to `baseLocale` ("en") with no cookie/URL
 * strategy resolved in jsdom, so `m.*()` calls render English strings directly, same
 * as `change-preview.test.ts` observed.
 *
 * Scope note (per task instructions): "the timer page renders no Running_Indicator
 * while the day page does" is NOT tested here — that assertion is about
 * `+layout.svelte` (task 1.10, a different file/task entirely), not about
 * `SettingsMenu` itself. It is out of scope for this file and is left uncovered;
 * there is no dedicated layout/shell test task in tasks.md to home it in.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SettingsMenu from '../../../src/lib/ui/layout/SettingsMenu.svelte';
import * as m from '../../../src/lib/paraglide/messages';

function renderMenu(density: 'desktop' | 'mobile') {
	return render(SettingsMenu, { props: { density } });
}

async function openMenu(): Promise<HTMLElement> {
	const chip = screen.getByRole('button', { name: m.aria_open_settings() });
	await fireEvent.click(chip);
	return chip;
}

describe('SettingsMenu', () => {
	it('renders the three-way Theme_Switcher, the two-way Locale_Switcher and exactly one logout control, in that order (Requirement 1.18/1.19)', async () => {
		renderMenu('desktop');
		await openMenu();

		const radios = screen.getAllByRole('radio');
		const radioLabels = radios.map((el) => el.textContent?.trim());
		expect(radioLabels).toEqual([
			m.settings_theme_system(),
			m.settings_theme_light(),
			m.settings_theme_dark(),
			m.settings_language_cs(),
			m.settings_language_en()
		]);

		const logoutButtons = screen.getAllByRole('button', { name: m.settings_logout() });
		expect(logoutButtons.length).toBe(1);

		// DOM order: every radio (theme, then locale) comes before the logout control.
		const panel = document.querySelector('.settings-menu__panel') as HTMLElement;
		const ordered = Array.from(
			panel.querySelectorAll<HTMLElement>('button:not([disabled]), [role="radio"]')
		);
		expect(ordered.length).toBe(6); // 5 radios + 1 logout submit button
		expect(ordered.slice(0, 5)).toEqual(radios);
		expect(ordered[5]).toBe(logoutButtons[0]);
	});

	it('Escape closes the desktop popover and returns focus to the chip (Requirement 1.21)', async () => {
		renderMenu('desktop');
		const chip = await openMenu();

		expect(screen.getByRole('dialog')).toBeInTheDocument();

		await fireEvent.keyDown(window, { key: 'Escape' });

		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(chip);
	});

	it('Escape closes the mobile sheet and returns focus to the chip (Requirement 1.21)', async () => {
		renderMenu('mobile');
		const chip = await openMenu();

		expect(screen.getByRole('dialog')).toBeInTheDocument();

		await fireEvent.keyDown(window, { key: 'Escape' });

		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(chip);
	});

	it('at mobile density renders a scrim, with no inline opacity styling anywhere in its own markup', async () => {
		const { container } = renderMenu('mobile');
		await openMenu();

		const scrim = document.querySelector('.settings-menu__scrim');
		expect(scrim).toBeInTheDocument();
		// No inline style attribute at all (the scrim's fade-in is a CSS @keyframes
		// animation, not an inline opacity) — scoped to what SettingsMenu itself
		// renders, since "the page content"/"the tab bar" belong to the layout, not
		// this component, and do not exist in this isolated render.
		expect(scrim).not.toHaveAttribute('style');

		// Nothing SettingsMenu renders — trigger, scrim, or panel — carries an inline
		// style anywhere, so none of it could be setting an opacity out-of-band.
		const allNodesInContainer = container.querySelectorAll<HTMLElement>('*');
		for (const el of allNodesInContainer) expect(el).not.toHaveAttribute('style');
		const allNodesInBody = document.body.querySelectorAll<HTMLElement>('.settings-menu, .settings-menu *');
		for (const el of allNodesInBody) expect(el).not.toHaveAttribute('style');
	});
});

afterEach(() => {
	// Belt-and-braces: modal-stack.ts's pushModal marks document.body's OTHER
	// children inert on open; a test that fails before its own Escape/cleanup could
	// otherwise leak an inert body into a later test file's DOM if Vitest ever shares
	// a document across files (it does not, today, but this keeps the intent local
	// rather than relying on that).
	for (const el of Array.from(document.body.children)) {
		if (el instanceof HTMLElement) el.inert = false;
	}
	document.body.classList.remove('modal-scroll-lock');
});
