/**
 * The single `day_boundary_config` row (Requirements 10.10, 10.11, 10.12). No Drizzle
 * table definition — a one-row table is simplest as raw SQL, per the design's file
 * list.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';

export type DayBoundaryConfig = { timezone: string; dayStartHour: number };

export async function readDayBoundaryConfig(tx: Tx): Promise<DayBoundaryConfig | null> {
	const rows = (await tx.execute(
		sql`select timezone, day_start_hour from day_boundary_config where id = true`
	)) as unknown as { timezone: string; day_start_hour: number }[];
	const row = rows[0];
	if (row === undefined) return null;
	return { timezone: row.timezone, dayStartHour: row.day_start_hour };
}

export async function writeDayBoundaryConfig(tx: Tx, value: DayBoundaryConfig): Promise<void> {
	await tx.execute(
		sql`insert into day_boundary_config (id, timezone, day_start_hour)
		    values (true, ${value.timezone}, ${value.dayStartHour})
		    on conflict (id) do update set timezone = excluded.timezone, day_start_hour = excluded.day_start_hour`
	);
}
