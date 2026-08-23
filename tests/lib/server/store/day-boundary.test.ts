import { describe, expect, it } from 'vitest';
import { withTx } from '../../../../src/lib/server/store/tx';
import {
	readDayBoundaryConfig,
	writeDayBoundaryConfig
} from '../../../../src/lib/server/store/day-boundary';

describe('day-boundary store', () => {
	it('an absent row reads as null', async () => {
		expect(await withTx((tx) => readDayBoundaryConfig(tx))).toBeNull();
	});

	it('writing creates the row, and writing again overwrites it (the readiness probe upserts)', async () => {
		await withTx((tx) =>
			writeDayBoundaryConfig(tx, { timezone: 'Europe/Prague', dayStartHour: 3 })
		);
		expect(await withTx((tx) => readDayBoundaryConfig(tx))).toEqual({
			timezone: 'Europe/Prague',
			dayStartHour: 3
		});

		await withTx((tx) => writeDayBoundaryConfig(tx, { timezone: 'UTC', dayStartHour: 0 }));
		expect(await withTx((tx) => readDayBoundaryConfig(tx))).toEqual({
			timezone: 'UTC',
			dayStartHour: 0
		});
	});
});
