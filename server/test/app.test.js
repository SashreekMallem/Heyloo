import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
const app = createApp();
describe('health endpoint', () => {
    it('returns ok status', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ok');
    });
});
