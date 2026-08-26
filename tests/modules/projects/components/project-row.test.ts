/**
 * Component tests for `ProjectRow`'s billable toggle — 003-worklog-time-categories,
 * task 10.3. Follows the pattern established by `project-picker.test.ts`:
 * `@testing-library/svelte` in the `components` Vitest project (jsdom), Paraglide's
 * `getLocale()` defaulting to `baseLocale` ("en") with no explicit init needed.
 *
 * Covers: toggling posts to the expected action (Requirement 9.4 — one named action
 * per operation, mirroring archive/unarchive); the label reflects the current state
 * as plain text, never colour alone (Requirement 9.3).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ProjectRow from '../../../../src/modules/projects/components/ProjectRow.svelte';
import type { Project } from '../../../../src/lib/contracts/models';
import * as m from '../../../../src/lib/paraglide/messages';

function projectFixture(overrides: Partial<Project> = {}): Project {
	return {
		id: 'project-1',
		name: 'Client Work',
		colorIndex: 0,
		billable: true,
		archivedAt: null,
		archived: false,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides
	};
}

describe('ProjectRow billable toggle', () => {
	it('a billable project shows the paid label and posts to ?/unbillable', () => {
		const project = { ...projectFixture({ billable: true }), coveredSeconds: 0 };
		render(ProjectRow, { props: { project, totalCoveredSeconds: 0 } });

		const badge = screen.getByRole('button', { name: m.projects_unbillable() });
		expect(badge).toHaveTextContent(m.category_paid());
		const form = badge.closest('form');
		expect(form).toHaveAttribute('action', '?/unbillable');
	});

	it('a non-billable project shows the unpaid label and posts to ?/billable', () => {
		const project = { ...projectFixture({ billable: false }), coveredSeconds: 0 };
		render(ProjectRow, { props: { project, totalCoveredSeconds: 0 } });

		const badge = screen.getByRole('button', { name: m.projects_billable() });
		expect(badge).toHaveTextContent(m.category_unpaid());
		const form = badge.closest('form');
		expect(form).toHaveAttribute('action', '?/billable');
	});
});
