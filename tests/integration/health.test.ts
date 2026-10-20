import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import * as prismaInfrastructure from '../../src/infrastructure/database/prisma.js';
import * as redisInfrastructure from '../../src/infrastructure/cache/redis.js';

describe('Health and Application Foundation Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /health/live (Liveness Probe)', () => {
    it('should return HTTP 200 with status ok and uptime', async () => {
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('uptimeSeconds');
      expect(typeof response.body.uptimeSeconds).toBe('number');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.headers).toHaveProperty('x-correlation-id');
    });

    it('should also be accessible under the API prefix (/api/v1/health/live)', async () => {
      const response = await request(app).get('/api/v1/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('GET /health/ready (Readiness Probe)', () => {
    it('should return HTTP 200 when both PostgreSQL and Redis are healthy', async () => {
      vi.spyOn(prismaInfrastructure, 'checkDatabaseHealth').mockResolvedValue(true);
      vi.spyOn(redisInfrastructure, 'checkRedisHealth').mockResolvedValue(true);

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ready',
        components: {
          database: 'up',
          cache: 'up',
        },
        timestamp: expect.any(String),
      });
    });

    it('should return HTTP 503 when PostgreSQL database is unreachable', async () => {
      vi.spyOn(prismaInfrastructure, 'checkDatabaseHealth').mockResolvedValue(false);
      vi.spyOn(redisInfrastructure, 'checkRedisHealth').mockResolvedValue(true);

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'unhealthy',
        components: {
          database: 'down',
          cache: 'up',
        },
        timestamp: expect.any(String),
      });
      // Ensure no sensitive connection strings or errors are exposed
      expect(JSON.stringify(response.body)).not.toContain('postgresql://');
      expect(JSON.stringify(response.body)).not.toContain('password');
    });

    it('should return HTTP 503 when Redis cache is unreachable', async () => {
      vi.spyOn(prismaInfrastructure, 'checkDatabaseHealth').mockResolvedValue(true);
      vi.spyOn(redisInfrastructure, 'checkRedisHealth').mockResolvedValue(false);

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'unhealthy',
        components: {
          database: 'up',
          cache: 'down',
        },
        timestamp: expect.any(String),
      });
    });

    it('should return HTTP 503 when both dependencies are down', async () => {
      vi.spyOn(prismaInfrastructure, 'checkDatabaseHealth').mockResolvedValue(false);
      vi.spyOn(redisInfrastructure, 'checkRedisHealth').mockResolvedValue(false);

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.components.database).toBe('down');
      expect(response.body.components.cache).toBe('down');
    });
  });

  describe('Middleware, Security Headers & Error Handling', () => {
    it('should inject X-Correlation-ID into responses', async () => {
      const customId = 'test-correlation-uuid-1234';
      const response = await request(app)
        .get('/health/live')
        .set('X-Correlation-ID', customId);

      expect(response.status).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(customId);
    });

    it('should include Helmet security headers on responses', async () => {
      const response = await request(app).get('/health/live');

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options');
    });

    it('should return appropriate CORS headers for configured origin', async () => {
      const response = await request(app)
        .get('/health/live')
        .set('Origin', 'http://localhost:3000');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should return RFC 7807 formatted 404 for unmapped endpoints', async () => {
      const response = await request(app).get('/api/v1/unknown-endpoint');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('type', 'https://api.amrutam.co.in/errors/not-found');
      expect(response.body).toHaveProperty('title', 'NOT_FOUND');
      expect(response.body).toHaveProperty('status', 404);
      expect(response.body).toHaveProperty('instance', '/api/v1/unknown-endpoint');
      expect(response.body).toHaveProperty('correlationId');
    });
  });
});
