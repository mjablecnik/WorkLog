<script lang="ts" generics="T extends { id: string }">
	import { untrack, type Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Icon from '../elements/Icon.svelte';
	import type { IconName } from '../elements/Icon.svelte';
	import Select from '../elements/Select.svelte';
	import EmptyState from './EmptyState.svelte';
	import SearchInput from '../forms/SearchInput.svelte';
	import LoadingSkeleton from '../overlays/LoadingSkeleton.svelte';
	import {
		nextSortState,
		getPageNumbers,
		paginate,
		loadColumnVisibility,
		saveColumnVisibility,
		type Column,
		type BulkAction,
		type SortState
	} from './data-table-utils';

	/**
	 * Every UI string the table's own chrome needs (as opposed to `Column.header`
	 * and `BulkAction.label`, which the caller already supplies per-column) is
	 * bundled here rather than pulled from `$lib/paraglide/messages` directly —
	 * this component has no `table_*` catalogue keys of its own, matching the
	 * "no hardcoded UI text" rule the rest of `src/lib/ui/` follows.
	 */
	interface DataTableLabels {
		searchLabel: string;
		searchClearLabel: string;
		columnsToggle: string;
		selectedCount: (count: number) => string;
		selectAll: string;
		selectRow: string;
		rowsPerPage: string;
		previousPage: string;
		nextPage: string;
		pageNumber: (page: number) => string;
		showingRange: (from: number, to: number, total: number) => string;
		/** Shown when there are no rows and no active search. */
		emptyMessage: string;
		/** Shown when a search is active and it matched nothing. */
		noResultsMessage: string;
	}

	interface Props {
		columns: Column<T>[];
		data: T[];
		loading?: boolean;
		totalItems: number;
		currentPage: number;
		perPage?: number;
		tableId: string;
		sort?: SortState;
		search?: string;
		bulkActions?: BulkAction[];
		emptyIcon: IconName;
		emptyAction?: { label: string; onclick: () => void };
		getRowHref?: (row: T) => string;
		labels: DataTableLabels;
		cell?: Snippet<[T, Column<T>]>;
		onsort?: (state: SortState) => void;
		onsearch?: (value: string) => void;
		onpaginate?: (state: { page: number; perPage: number }) => void;
		onselect?: (selectedIds: string[]) => void;
	}

	let {
		columns,
		data,
		loading = false,
		totalItems,
		currentPage,
		perPage = 25,
		tableId,
		sort,
		search = '',
		bulkActions = [],
		emptyIcon,
		emptyAction,
		getRowHref,
		labels,
		cell,
		onsort,
		onsearch,
		onpaginate,
		onselect
	}: Props = $props();

	const perPageOptions = [
		{ value: '10', label: '10' },
		{ value: '25', label: '25' },
		{ value: '50', label: '50' },
		{ value: '100', label: '100' }
	];

	function hiddenByDefaultKeys(): string[] {
		return columns.filter((column) => column.hidden).map((column) => column.key);
	}

	let visibility = $state<Record<string, boolean>>(
		untrack(() =>
			loadColumnVisibility(
				tableId,
				columns.map((column) => column.key),
				hiddenByDefaultKeys()
			)
		)
	);
	let previousTableId = untrack(() => tableId);
	$effect(() => {
		if (tableId !== previousTableId) {
			previousTableId = tableId;
			visibility = loadColumnVisibility(
				tableId,
				columns.map((column) => column.key),
				hiddenByDefaultKeys()
			);
		}
	});

	const visibleColumns = $derived(columns.filter((column) => visibility[column.key] !== false));
	const showCheckboxes = $derived(bulkActions.length > 0);
	const visibleColumnCount = $derived(visibleColumns.length + (showCheckboxes ? 1 : 0));

	let selectedIds = $state<string[]>([]);
	let previousPage = untrack(() => currentPage);
	$effect(() => {
		if (currentPage !== previousPage) {
			previousPage = currentPage;
			if (selectedIds.length > 0) {
				selectedIds = [];
				onselect?.([]);
			}
		}
	});

	const allOnPageSelected = $derived(data.length > 0 && data.every((row) => selectedIds.includes(row.id)));
	const someOnPageSelected = $derived(!allOnPageSelected && data.some((row) => selectedIds.includes(row.id)));

	let selectAllEl: HTMLInputElement | undefined = $state();
	$effect(() => {
		if (selectAllEl) selectAllEl.indeterminate = someOnPageSelected;
	});

	const pagination = $derived(paginate(currentPage, perPage, totalItems));
	const pageNumbers = $derived(getPageNumbers(pagination.page, pagination.totalPages));

	let searchDraft = $state(untrack(() => search));
	let previousSearchEmit = $state(untrack(() => search));
	let previousSearchProp = untrack(() => search);
	$effect(() => {
		if (search !== previousSearchProp) {
			previousSearchProp = search;
			previousSearchEmit = search;
			searchDraft = search;
		}
	});
	$effect(() => {
		const value = searchDraft;
		if (value === previousSearchEmit) return;
		previousSearchEmit = value;
		onsearch?.(value);
	});

	let perPageDraft = $derived(String(perPage));
	$effect(() => {
		const next = Number(perPageDraft);
		if (next !== perPage) {
			onpaginate?.({ page: 1, perPage: next });
		}
	});

	let columnsMenuOpen = $state(false);
	let columnsMenuEl: HTMLElement | undefined = $state();

	function handleWindowClick(event: MouseEvent): void {
		if (!columnsMenuOpen) return;
		if (columnsMenuEl && !columnsMenuEl.contains(event.target as Node)) {
			columnsMenuOpen = false;
		}
	}

	function handleSortClick(column: Column<T>): void {
		if (!column.sortable) return;
		onsort?.(nextSortState(sort, column.key));
	}

	function cellValue(row: T, column: Column<T>): string {
		if (column.render) return column.render(row);
		const value = row[column.key];
		return value === null || value === undefined ? '' : String(value);
	}

	function goToPage(page: number): void {
		if (page < 1 || page > pagination.totalPages || page === pagination.page) return;
		onpaginate?.({ page, perPage });
	}

	function toggleRow(id: string): void {
		selectedIds = selectedIds.includes(id) ? selectedIds.filter((rowId) => rowId !== id) : [...selectedIds, id];
		onselect?.(selectedIds);
	}

	function toggleSelectAll(): void {
		const pageIds = data.map((row) => row.id);
		if (allOnPageSelected) {
			const pageIdSet = new Set(pageIds);
			selectedIds = selectedIds.filter((id) => !pageIdSet.has(id));
		} else {
			selectedIds = [...new Set([...selectedIds, ...pageIds])];
		}
		onselect?.(selectedIds);
	}

	function toggleColumn(key: string): void {
		const isVisible = visibility[key] !== false;
		const visibleCount = columns.filter((column) => visibility[column.key] !== false).length;
		if (isVisible && visibleCount <= 1) return;
		visibility = { ...visibility, [key]: !isVisible };
		saveColumnVisibility(tableId, visibility);
	}
</script>

<svelte:window onclick={handleWindowClick} />

<div class="data-table">
	<div class="data-table__toolbar">
		<div class="data-table__search">
			<SearchInput bind:value={searchDraft} label={labels.searchLabel} clearLabel={labels.searchClearLabel} />
		</div>
		<div class="data-table__toolbar-actions">
			<div class="data-table__columns" bind:this={columnsMenuEl}>
				<button
					type="button"
					class="data-table__columns-toggle"
					aria-label={labels.columnsToggle}
					aria-expanded={columnsMenuOpen}
					onclick={() => (columnsMenuOpen = !columnsMenuOpen)}
				>
					<Icon name="settings" size={18} />
				</button>
				{#if columnsMenuOpen}
					<div class="data-table__columns-menu" role="menu">
						{#each columns as column (column.key)}
							<label class="data-table__columns-option">
								<input
									type="checkbox"
									checked={visibility[column.key] !== false}
									onchange={() => toggleColumn(column.key)}
								/>
								{column.header}
							</label>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	{#if selectedIds.length > 0}
		<div class="data-table__bulk-bar">
			<span class="data-table__bulk-count">{labels.selectedCount(selectedIds.length)}</span>
			<div class="data-table__bulk-actions">
				{#each bulkActions as action (action.label)}
					<button type="button" class="data-table__bulk-action" onclick={() => action.onAction(selectedIds)}>
						{#if action.icon}<Icon name={action.icon as IconName} size={16} />{/if}
						{action.label}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<div class="data-table__scroll">
		<table class="data-table__table">
			<thead>
				<tr>
					{#if showCheckboxes}
						<th class="data-table__cell--checkbox">
							<input
								bind:this={selectAllEl}
								type="checkbox"
								aria-label={labels.selectAll}
								checked={allOnPageSelected}
								disabled={data.length === 0}
								onchange={toggleSelectAll}
							/>
						</th>
					{/if}
					{#each visibleColumns as column (column.key)}
						{#if column.sortable}
							<th
								class:data-table__cell--numeric={column.type === 'number'}
								aria-sort={sort?.key === column.key
									? sort.direction === 'asc'
										? 'ascending'
										: 'descending'
									: 'none'}
							>
								<button type="button" class="data-table__sort-button" onclick={() => handleSortClick(column)}>
									{column.header}
									{#if sort?.key === column.key}
										<Icon name="chevron-down" size={14} class={sort.direction === 'asc' ? 'data-table__sort-icon--asc' : ''} />
									{/if}
								</button>
							</th>
						{:else}
							<th class:data-table__cell--numeric={column.type === 'number'}>
								{column.header}
							</th>
						{/if}
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if loading}
					{#each { length: perPage } as _, rowIndex (rowIndex)}
						<tr>
							{#each { length: visibleColumnCount } as _, cellIndex (cellIndex)}
								<td><LoadingSkeleton /></td>
							{/each}
						</tr>
					{/each}
				{:else}
					{#each data as row (row.id)}
						<tr>
							{#if showCheckboxes}
								<td class="data-table__cell--checkbox" data-label="">
									<input
										type="checkbox"
										aria-label={labels.selectRow}
										checked={selectedIds.includes(row.id)}
										onchange={() => toggleRow(row.id)}
									/>
								</td>
							{/if}
							{#each visibleColumns as column, columnIndex (column.key)}
								<td class:data-table__cell--numeric={column.type === 'number'} data-label={column.header}>
									{#if getRowHref && columnIndex === 0}
										<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -- getRowHref(row) is a plain caller-supplied string, not a route-id literal; resolve() needs an escape hatch here -->
										{@const href = resolve(getRowHref(row) as any)}
										<a {href} class="data-table__row-link">{cellValue(row, column)}</a>
									{:else if cell}
										{@render cell(row, column)}
									{:else}
										{cellValue(row, column)}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	{#if !loading && data.length === 0}
		<EmptyState
			icon={emptyIcon}
			message={search.trim() ? labels.noResultsMessage : labels.emptyMessage}
			action={emptyAction}
		/>
	{/if}

	{#if !loading && data.length > 0}
		<p class="data-table__info">
			{labels.showingRange(pagination.from, pagination.to, totalItems)}
		</p>
	{/if}

	{#if totalItems > 0}
		<div class="data-table__pagination">
			<Select options={perPageOptions} bind:value={perPageDraft} class="data-table__per-page" />
			<span class="sr-only">{labels.rowsPerPage}</span>
			<div class="data-table__pages">
				<button
					type="button"
					class="data-table__page-button"
					aria-label={labels.previousPage}
					disabled={pagination.page === 1}
					onclick={() => goToPage(pagination.page - 1)}
				>
					<Icon name="chevron-left" size={16} />
				</button>
				{#each pageNumbers as pageNumber (pageNumber)}
					<button
						type="button"
						class="data-table__page-button"
						class:data-table__page-button--current={pageNumber === pagination.page}
						aria-current={pageNumber === pagination.page ? 'page' : undefined}
						aria-label={labels.pageNumber(pageNumber)}
						onclick={() => goToPage(pageNumber)}
					>
						{pageNumber}
					</button>
				{/each}
				<button
					type="button"
					class="data-table__page-button"
					aria-label={labels.nextPage}
					disabled={pagination.page === pagination.totalPages}
					onclick={() => goToPage(pagination.page + 1)}
				>
					<Icon name="chevron-right" size={16} />
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.data-table {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
	}

	.data-table__toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.data-table__search {
		flex: 1;
		max-width: 24rem;
	}

	.data-table__toolbar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.data-table__columns {
		position: relative;
	}

	.data-table__columns-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border: none;
		border-radius: var(--radius-11);
		background: var(--field);
		color: var(--text-dim);
		cursor: pointer;
		transition: background-color var(--dur-hover) var(--ease-standard);
	}

	.data-table__columns-toggle:hover {
		background: var(--field-hover);
	}

	.data-table__columns-menu {
		position: absolute;
		right: 0;
		z-index: 10;
		margin-top: 4px;
		min-width: 12rem;
		padding: 8px;
		border: 1px solid var(--menu-border);
		border-radius: var(--radius-14);
		background: var(--dialog);
		box-shadow: var(--menu-shadow);
		--focus-gap: var(--dialog);
	}

	.data-table__columns-option {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
		font-size: 13px;
		cursor: pointer;
	}

	.data-table__bulk-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 12px;
		border-radius: var(--radius-11);
		background: var(--segment-active);
		color: var(--accent);
		font-size: 13px;
	}

	.data-table__bulk-actions {
		display: flex;
		gap: 8px;
	}

	.data-table__bulk-action {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 6px 12px;
		border: none;
		border-radius: var(--radius-9);
		background: var(--dialog);
		color: var(--text);
		cursor: pointer;
	}

	.data-table__scroll {
		overflow-x: auto;
		border: 1px solid var(--divider);
		border-radius: var(--radius-14);
	}

	.data-table__table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13.5px;
	}

	.data-table__table th,
	.data-table__table td {
		padding: 10px 12px;
		text-align: left;
		border-bottom: 1px solid var(--divider);
	}

	.data-table__table thead th {
		color: var(--text-faint);
		font-weight: 500;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: var(--row);
	}

	.data-table__table tbody tr:last-child td {
		border-bottom: none;
	}

	.data-table__table tbody tr:hover {
		background: var(--row-hover);
	}

	.data-table__cell--checkbox {
		width: 40px;
	}

	.data-table__cell--numeric {
		text-align: right;
	}

	.data-table__row-link {
		display: block;
		color: inherit;
		text-decoration: none;
	}

	.data-table__row-link:hover {
		text-decoration: underline;
	}

	.data-table__sort-button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		cursor: pointer;
		padding: 0;
	}

	.data-table :global(.data-table__sort-icon--asc) {
		transform: rotate(180deg);
	}

	.data-table__info {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-faint);
	}

	.data-table__pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.data-table :global(.data-table__per-page) {
		width: auto;
		min-width: 5rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.data-table__pages {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.data-table__page-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 36px;
		min-height: 36px;
		padding: 0 8px;
		border: none;
		border-radius: var(--radius-9);
		background: var(--field);
		color: var(--text-dim);
		font-size: 13px;
		cursor: pointer;
	}

	.data-table__page-button:hover:not(:disabled) {
		background: var(--field-hover);
	}

	.data-table__page-button:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.data-table__page-button--current {
		background: var(--accent);
		color: var(--ink-on-accent);
	}

	@media (max-width: 767px) {
		.data-table__table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}

		.data-table__table,
		.data-table__table tbody,
		.data-table__table tr,
		.data-table__table td {
			display: block;
			width: 100%;
		}

		.data-table__table tr {
			margin-bottom: 12px;
			border-bottom: 1px solid var(--divider);
		}

		.data-table__table tr:last-child {
			margin-bottom: 0;
		}

		.data-table__table td {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			border-bottom: none;
		}

		.data-table__table td[data-label]:not([data-label='']):before {
			content: attr(data-label);
			font-weight: 500;
			color: var(--text-faint);
		}
	}
</style>
