/**
 * Vitest setup for the `server` project. Exports `resetDb()`, which every
 * database-touching suite calls between tests to truncate every table. Implemented in
 * full by task 4.9, once the store layer exists to connect through; until then this is
 * a safe no-op so suites that do not yet touch a database (config, errors, security
 * headers) can run under the same Vitest project.
 */
export async function resetDb(): Promise<void> {
	// Filled in by task 4.9.
}
