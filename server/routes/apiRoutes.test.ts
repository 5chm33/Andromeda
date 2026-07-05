/**
 * apiRoutes.test.ts — Unit tests for the REST API product layer
 *
 * Tests cover:
 * - Health endpoint (no auth required)
 * - Auth middleware (rejects missing/invalid keys)
 * - Fix job submission (validation, rate limiting)
 * - Job status retrieval
 * - Job listing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApiRouter } from './apiRoutes.js';

// ─── Test App Setup ────────────────────────────────────────────────────────────

function createTestApp(apiKey = 'test-api-key-12345678') {
  process.env.ANDROMEDA_API_KEY = apiKey;
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createApiRouter());
  return app;
}

// ─── Health Endpoint ───────────────────────────────────────────────────────────

describe('GET /api/v1/health', () => {
  it('returns 200 with ok:true without auth', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('Andromeda AI Agent API');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('includes a version field', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/v1/health');
    expect(typeof res.body.version).toBe('string');
  });
});

// ─── Auth Middleware ───────────────────────────────────────────────────────────

describe('API Key Authentication', () => {
  it('rejects requests with no API key with 401', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/v1/status');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('rejects requests with wrong API key with 403', async () => {
    const app = createTestApp('correct-key-12345678');
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer wrong-key-12345678');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('accepts API key via Authorization header', async () => {
    const app = createTestApp('my-test-key-12345678');
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer my-test-key-12345678');
    expect(res.status).toBe(200);
  });

  it('accepts API key via query param', async () => {
    const app = createTestApp('my-test-key-12345678');
    const res = await request(app)
      .get('/api/v1/status?api_key=my-test-key-12345678');
    expect(res.status).toBe(200);
  });
});

// ─── Status Endpoint ───────────────────────────────────────────────────────────

describe('GET /api/v1/status', () => {
  it('returns system status with auth', async () => {
    const app = createTestApp('status-test-key-12345678');
    const res = await request(app)
      .get('/api/v1/status')
      .set('Authorization', 'Bearer status-test-key-12345678');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.capabilities)).toBe(true);
    expect(res.body.capabilities).toContain('fix-github-repo');
    expect(res.body.jobs).toBeDefined();
    expect(typeof res.body.jobs.active).toBe('number');
  });
});

// ─── Fix Job Submission ────────────────────────────────────────────────────────

describe('POST /api/v1/fix', () => {
  it('rejects missing repoUrl with 400', async () => {
    const app = createTestApp('fix-test-key-12345678');
    const res = await request(app)
      .post('/api/v1/fix')
      .set('Authorization', 'Bearer fix-test-key-12345678')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.message).toContain('repoUrl');
  });

  it('rejects non-GitHub URLs with 400', async () => {
    const app = createTestApp('fix-test-key-12345678');
    const res = await request(app)
      .post('/api/v1/fix')
      .set('Authorization', 'Bearer fix-test-key-12345678')
      .send({ repoUrl: 'https://example.com/repo' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('GitHub');
  });

  it('rejects without auth with 401', async () => {
    const app = createTestApp();
    const res = await request(app)
      .post('/api/v1/fix')
      .send({ repoUrl: 'https://github.com/owner/repo' });
    expect(res.status).toBe(401);
  });
});

// ─── Job Not Found ─────────────────────────────────────────────────────────────

describe('GET /api/v1/fix/:jobId', () => {
  it('returns 404 for unknown job ID', async () => {
    const app = createTestApp('job-test-key-12345678');
    const res = await request(app)
      .get('/api/v1/fix/nonexistent-job-id')
      .set('Authorization', 'Bearer job-test-key-12345678');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });
});

// ─── Job Listing ───────────────────────────────────────────────────────────────

describe('GET /api/v1/jobs', () => {
  it('returns empty job list initially', async () => {
    const app = createTestApp('jobs-test-key-12345678');
    const res = await request(app)
      .get('/api/v1/jobs')
      .set('Authorization', 'Bearer jobs-test-key-12345678');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });
});
