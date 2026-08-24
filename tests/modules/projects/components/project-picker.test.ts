/**
 * Component tests for `ProjectPicker` (task 7.3). Follows the pattern established by
 * `tests/modules/day/components/change-preview.test.ts`: `@testing-library/svelte` in
 * the `components` Vitest project (jsdom), Paraglide's `getLocale()` defaulting to
 * `baseLocale` ("en") with no explicit init needed, and small local fixture builders.
 *
 * Covers task 7.3's bullet list, one group per bullet:
 *  1. Filtering by substring (case-insensitive, on the trimmed query).
 *  2. Archived projects absent from the open list, but shown — badged — as the closed
 *     display's current value when `value` points at one (Requirement 11.12).
 *  3. Inline creation inserts and selects without closing the surrounding dialog
 *     (there is no "close the dialog" signal in this component's API at all — the test
 *     only checks `onChange`/`onCreate`/the dropdown closing, never invents one).
 *  4. Full keyboard navigation (ArrowDown/ArrowUp/Home/End/Enter/Escape).
 *  5. Every option names the project as text, never the swatch alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import ProjectPicker from '../../../../src/modules/projects/components/ProjectPicker.svelte';
import type { Project } from '../../../../src/lib/contracts/models';
import * as m from '../../../../src/lib/paraglide/messages';

// --- Fixture builder ------------------------------------------------------------------

let idCounter = 0;

function projectFixture(overrides: Partial<Project> = {}): Project {
	idCounter += 1;
	return {
		id: `project-${idCounter}`,
		name: `Project ${idCounter}`,
		colorIndex: 0,
		archivedAt: null,
		archived: false,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides
	};
}

// --- Render helper ---------------------------------------------------------------------

type ProjectPickerProps = {
	projects: Project[];
	value: string | null;
	onChange: (projectId: string) => void;
	onCreate: (project: Project) => void;
};

function renderPicker(props: Partial<ProjectPickerProps> = {}) {
	const onChange = props.onChange ?? vi.fn();
	const onCreate = props.onCreate ?? vi.fn();
	const result = render(ProjectPicker, {
		props: {
			projects: [],
			value: null,
			onChange,
			onCreate,
			...props
		}
	});
	const input = screen.getByRole('combobox') as HTMLInputElement;
	return { ...result, input, onChange, onCreate };
}

/** Options actually offered for selection — excludes the "no match" caption
 * (`role="presentation"`) and any create-error alert (`role="alert"`). */
function getOptions(): HTMLElement[] {
	return screen.getAllByRole('option');
}

/**
 * Opens the dropdown the way a real user does: a genuine DOM `.focus()` call, not
 * `fireEvent.focus()` (which only dispatches a synthetic event without moving
 * `document.activeElement`). This matters because `selectProject`/`handleCreate` call
 * `inputEl?.focus()` themselves after closing the dropdown — a no-op in a real browser
 * when the input is already truly focused (as it always is mid-interaction, since the
 * option row's `onmousedown` prevents the browser's default blur), but a *second*,
 * genuine focus event if the test never gave the input real focus to begin with. Using
 * a real `.focus()` here keeps the test's starting state realistic.
 */
async function focusInput(input: HTMLInputElement): Promise<void> {
	input.focus();
	await tick();
}

afterEach(() => {
	vi.unstubAllGlobals();
});

// --- Tests ------------------------------------------------------------------------------

describe('ProjectPicker', () => {
	describe('filtering by substring (Requirement 11.6)', () => {
		it('shows only options whose name contains the query, case-insensitively', async () => {
			const website = projectFixture({ name: 'Website Redesign' });
			const marketing = projectFixture({ name: 'Marketing Site' });
			const onboarding = projectFixture({ name: 'Client Onboarding' });
			const { input } = renderPicker({ projects: [website, marketing, onboarding] });

			await focusInput(input);
			await fireEvent.input(input, { target: { value: 'SiTe' } });

			expect(screen.getByRole('option', { name: /Website Redesign/ })).toBeInTheDocument();
			expect(screen.getByRole('option', { name: /Marketing Site/ })).toBeInTheDocument();
			expect(screen.queryByRole('option', { name: /Client Onboarding/ })).toBeNull();
			expect(getOptions().length).toBe(2);
		});
	});

	describe('archived projects (Requirements 11.6, 11.12)', () => {
		it('excludes an archived project from the open list when it is not the current value', async () => {
			const active = projectFixture({ name: 'Active Project' });
			const archived = projectFixture({ name: 'Retired Project', archived: true, archivedAt: new Date() });
			const { input } = renderPicker({ projects: [active, archived], value: null });

			await focusInput(input);

			expect(screen.getByRole('option', { name: /Active Project/ })).toBeInTheDocument();
			expect(screen.queryByRole('option', { name: /Retired Project/ })).toBeNull();
			expect(getOptions().length).toBe(1);
		});

		it('shows an archived current value, badged, in the closed display', () => {
			const archived = projectFixture({ name: 'Retired Project', archived: true, archivedAt: new Date() });
			const { input } = renderPicker({ projects: [archived], value: archived.id });

			// Closed state: the dropdown never opened.
			expect(screen.queryByRole('listbox')).toBeNull();
			expect(input).toHaveValue('Retired Project');
			expect(screen.getByText(m.projects_archived_badge())).toBeInTheDocument();
		});
	});

	describe('inline creation (Requirements 6.8, 11.13)', () => {
		it('creates, selects and closes without any dialog-close signal', async () => {
			const existing = projectFixture({ name: 'Existing Project' });
			const onChange = vi.fn();
			const onCreate = vi.fn();
			const { input } = renderPicker({ projects: [existing], value: null, onChange, onCreate });

			await focusInput(input);
			await fireEvent.input(input, { target: { value: 'Design Sprint' } });

			const createRow = screen.getByRole('option', {
				name: new RegExp(m.projects_picker_create({ name: 'Design Sprint' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			});
			expect(createRow).toBeInTheDocument();

			const newProjectWire = {
				id: 'project-new',
				name: 'Design Sprint',
				colorIndex: 3,
				archivedAt: null,
				archived: false,
				createdAt: '2026-02-01T00:00:00.000Z',
				updatedAt: '2026-02-01T00:00:00.000Z'
			};
			const fetchMock = vi.fn(async () => ({
				ok: true,
				json: async () => newProjectWire
			}));
			vi.stubGlobal('fetch', fetchMock);

			await fireEvent.click(createRow);

			await waitFor(() => {
				expect(onChange).toHaveBeenCalledWith('project-new');
			});

			expect(fetchMock).toHaveBeenCalledWith(
				'/api/projects',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify({ name: 'Design Sprint' })
				})
			);

			expect(onCreate).toHaveBeenCalledWith({
				id: 'project-new',
				name: 'Design Sprint',
				colorIndex: 3,
				archivedAt: null,
				archived: false,
				createdAt: new Date('2026-02-01T00:00:00.000Z'),
				updatedAt: new Date('2026-02-01T00:00:00.000Z')
			});

			// Dropdown closed — no leftover listbox, and definitely nothing resembling a
			// "close the surrounding dialog" call: the component's API exposes only
			// `onChange`/`onCreate`, which is exactly what was asserted above.
			expect(screen.queryByRole('listbox')).toBeNull();
		});
	});

	describe('keyboard navigation (Requirement 14.11)', () => {
		it('moves aria-activedescendant through ArrowDown/ArrowUp/Home/End and selects on Enter', async () => {
			const projects = [
				projectFixture({ name: 'Alpha' }),
				projectFixture({ name: 'Bravo' }),
				projectFixture({ name: 'Charlie' }),
				projectFixture({ name: 'Delta' })
			];
			const onChange = vi.fn();
			const { input } = renderPicker({ projects, value: null, onChange });

			await focusInput(input);
			let options = getOptions();
			expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);

			await fireEvent.keyDown(input, { key: 'ArrowDown' });
			options = getOptions();
			expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);

			await fireEvent.keyDown(input, { key: 'ArrowDown' });
			options = getOptions();
			expect(input.getAttribute('aria-activedescendant')).toBe(options[2].id);

			await fireEvent.keyDown(input, { key: 'ArrowUp' });
			options = getOptions();
			expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);

			await fireEvent.keyDown(input, { key: 'End' });
			options = getOptions();
			expect(input.getAttribute('aria-activedescendant')).toBe(options[3].id);

			await fireEvent.keyDown(input, { key: 'Home' });
			options = getOptions();
			expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);

			await fireEvent.keyDown(input, { key: 'End' });
			await fireEvent.keyDown(input, { key: 'Enter' });

			expect(onChange).toHaveBeenCalledWith(projects[3].id);
			expect(screen.queryByRole('listbox')).toBeNull();
		});

		it('closes on Escape without calling onChange, leaving the value untouched', async () => {
			const projects = [projectFixture({ name: 'Alpha' }), projectFixture({ name: 'Bravo' })];
			const onChange = vi.fn();
			const { input } = renderPicker({ projects, value: null, onChange });

			await focusInput(input);
			await fireEvent.keyDown(input, { key: 'ArrowDown' });
			expect(screen.getByRole('listbox')).toBeInTheDocument();

			await fireEvent.keyDown(input, { key: 'Escape' });

			expect(screen.queryByRole('listbox')).toBeNull();
			expect(onChange).not.toHaveBeenCalled();
		});
	});

	describe('every option names the project as text (design.md § 8)', () => {
		it('renders each option with the project name as visible text, not just a swatch', async () => {
			const projects = [
				projectFixture({ name: 'Website Redesign', colorIndex: 1 }),
				projectFixture({ name: 'Client Onboarding', colorIndex: 4 }),
				projectFixture({ name: 'Marketing Site', colorIndex: 6 })
			];
			const { input } = renderPicker({ projects, value: null });

			await focusInput(input);
			const options = getOptions();
			expect(options.length).toBe(projects.length);

			for (const [index, project] of projects.entries()) {
				expect(within(options[index]).getByText(project.name)).toBeInTheDocument();
			}
		});
	});
});
