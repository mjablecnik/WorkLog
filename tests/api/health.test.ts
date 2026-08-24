import { describe, expect, it, vi } from 'vitest';
import { mockEvent, bodyOf } from './helpers';
import { GET as healthGet } from '../../src/routes/api/health/+server';
import { getConfig } from '../../src/lib/server/core/config';
import * as hooks from '../../src/hooks.server';

const BASE = 'http://localhost';

describe('health route', () => {
	it('200 with a reachable, migrated database, carrying the loaded configuration', async () => {
		const res = await healthGet(mockEvent({ url: `${BASE}/api/health` }));
		expect(res.status).toBe(200);
		const body = await bodyOf(res);
		const config = getConfig();
		expect(body).toMatchObject({
			status: 'ok',
			version: config.version,
			timezone: config.timezone,
			dayStartHour: config.dayStartHour,
			gaugeStart: config.gaugeStart,
			gaugeEnd: config.gaugeEnd,
			eveningHour: config.eveningHour,
			maxOpenSessionHours: config.maxOpenSessionHours
		});
	});

	it('503 degraded when the readiness probe reports not ready', async () => {
		const spy = vi
			.spyOn(hooks, 'getReadiness')
			.mockResolvedValue({ ready: false, reason: 'simulated for this test' });
		try {
			const res = await healthGet(mockEvent({ url: `${BASE}/api/health` }));
			expect(res.status).toBe(503);
			const body = await bodyOf(res);
			expect(body.status).toBe('degraded');
		} finally {
			spy.mockRestore();
		}
	});

	it('no credential is required — the mock event here carries no cookie or bearer token and still succeeds', async () => {
		const res = await healthGet(mockEvent({ url: `${BASE}/api/health`, headers: {} }));
		expect(res.status).toBe(200);
	});
});
