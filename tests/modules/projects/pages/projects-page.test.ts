/**
 * Component tests for `ProjectsPage`'s creation-time billable control —
 * 003-worklog-time-categories, task 10.3: creation defaults to paid (Requirement 9.2),
 * and clicking the unpaid option flips the hidden `billable` field the form submits.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ProjectsPage from '../../../../src/modules/projects/pages/ProjectsPage.svelte';
import * as m from '../../../../src/lib/paraglide/messages';

function renderPage() {
	return render(ProjectsPage, {
		props: { projects: [], totalCoveredSeconds: 0, activeCount: 0 }
	});
}

describe('ProjectsPage creation billable control', () => {
	it('defaults to paid', () => {
		const { container } = renderPage();
		const paidOption = screen.getByRole('radio', { name: m.category_paid() });
		const unpaidOption = screen.getByRole('radio', { name: m.category_unpaid() });
		expect(paidOption).toHaveAttribute('aria-checked', 'true');
		expect(unpaidOption).toHaveAttribute('aria-checked', 'false');

		const hidden = container.querySelector('input[name="billable"]') as HTMLInputElement;
		expect(hidden.value).toBe('true');
	});

	it('choosing unpaid flips the hidden billable field', async () => {
		const { container } = renderPage();
		const unpaidOption = screen.getByRole('radio', { name: m.category_unpaid() });
		await fireEvent.click(unpaidOption);

		expect(unpaidOption).toHaveAttribute('aria-checked', 'true');
		const hidden = container.querySelector('input[name="billable"]') as HTMLInputElement;
		expect(hidden.value).toBe('false');
	});
});
