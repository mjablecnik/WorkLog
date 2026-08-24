export interface Column<T> {
	key: keyof T & string;
	header: string;
	sortable?: boolean;
	type?: 'string' | 'number' | 'date' | 'boolean';
	render?: (row: T) => string;
	/** Column starts hidden (via the columns menu) unless the user has already saved a preference for this table. */
	hidden?: boolean;
}

export interface BulkAction {
	label: string;
	icon?: string;
	onAction: (selectedIds: string[]) => void;
}

export interface SortState {
	key: string;
	direction: 'asc' | 'desc';
}

/**
 * Cycles a column's sort direction: unsorted/other-column -> asc -> desc -> asc.
 */
export function nextSortState(current: SortState | undefined, clickedKey: string): SortState {
	if (!current || current.key !== clickedKey) {
		return { key: clickedKey, direction: 'asc' };
	}
	return { key: clickedKey, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

export function getPageNumbers(currentPage: number, totalPages: number, maxButtons = 7): number[] {
	if (totalPages <= 0) return [];
	if (totalPages <= maxButtons) {
		return Array.from({ length: totalPages }, (_, index) => index + 1);
	}

	let start = Math.max(1, currentPage - Math.floor(maxButtons / 2));
	let end = start + maxButtons - 1;
	if (end > totalPages) {
		end = totalPages;
		start = end - maxButtons + 1;
	}
	return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export interface PaginationParams {
	offset: number;
	totalPages: number;
	from: number;
	to: number;
	page: number;
	perPage: number;
}

/** Local to this component — the project has no shared `db/helpers.paginate`
 * (worklog's server layer is a REST API over its own domain model, not a
 * generic query-builder pagination helper), and this is small enough not to
 * invent one just for `DataTable`. */
export function paginate(page: number, perPage: number, total: number): PaginationParams {
	const clampedPerPage = perPage < 1 ? 25 : Math.min(perPage, 100);
	const clampedTotal = Math.max(total, 0);

	if (clampedTotal === 0) {
		return { offset: 0, totalPages: 0, from: 0, to: 0, page: 1, perPage: clampedPerPage };
	}

	const totalPages = Math.ceil(clampedTotal / clampedPerPage);
	const clampedPage = Math.min(Math.max(page < 1 ? 1 : page, 1), totalPages);

	const offset = (clampedPage - 1) * clampedPerPage;
	const from = offset + 1;
	const to = Math.min(offset + clampedPerPage, clampedTotal);

	return { offset, totalPages, from, to, page: clampedPage, perPage: clampedPerPage };
}

const COLUMN_VISIBILITY_STORAGE_SUFFIX = '_columns';

export function loadColumnVisibility(
	tableId: string,
	allKeys: string[],
	hiddenByDefault: string[] = []
): Record<string, boolean> {
	const defaultFor = (key: string): boolean => !hiddenByDefault.includes(key);
	const defaults = Object.fromEntries(allKeys.map((key) => [key, defaultFor(key)]));
	if (typeof localStorage === 'undefined') return defaults;

	try {
		const raw = localStorage.getItem(`${tableId}${COLUMN_VISIBILITY_STORAGE_SUFFIX}`);
		if (!raw) return defaults;

		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== 'object' || parsed === null) return defaults;

		const saved = parsed as Record<string, unknown>;
		return Object.fromEntries(
			allKeys.map((key) => [key, typeof saved[key] === 'boolean' ? saved[key] : defaultFor(key)])
		);
	} catch {
		return defaults;
	}
}

export function saveColumnVisibility(tableId: string, visibility: Record<string, boolean>): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(`${tableId}${COLUMN_VISIBILITY_STORAGE_SUFFIX}`, JSON.stringify(visibility));
}
