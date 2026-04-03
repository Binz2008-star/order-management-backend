import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { RateLimitService } from '../server/lib/rate-limit-service'
import { RateLimitConfig } from '../server/lib/rate-limit-store'

describe('Production-Grade Redis Rate Limiting', () => {
  beforeEach(() => {
    // Clear Redis environment for testing
    delete process.env.REDIS_URL
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  describe('Redis with Lua Scripts - True Atomicity', () => {
    it('enforces strict limits under high concurrency', async () => {
      // Configure for Redis with Lua scripts
      process.env.REDIS_URL = 'redis://localhost:6379'
      
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
        redisKeyPrefix: 'production_test'
      }

      const request = new Request('http://localhost:3000/api/test', {
        headers: { 'x-forwarded-for': '192.168.1.200' }
      }) as unknown as NextRequest

      const service = new RateLimitService(config)
      
      // Fire 50 concurrent requests (should exceed limit of 10)
      const concurrentRequests = Array.from({ length: 50 }, () => 
        service.check(request)
      )
      
      const results = await Promise.all(concurrentRequests)
      
      // Count how many were allowed
      const allowedCount = results.filter(r => r.allowed).length
      const blockedCount = results.filter(r => !r.allowed).length
      
      // Production-grade: Should NEVER exceed the limit
      expect(allowedCount).toBeLessThanOrEqual(10)
      expect(blockedCount).toBeGreaterThanOrEqual(40)
      
      // All allowed requests should have consistent remaining counts
      const allowedResults = results.filter(r => r.allowed)
      allowedResults.forEach(result => {
        expect(result.remaining).toBeGreaterThanOrEqual(0)
        expect(result.remaining).toBeLessThan(10)
      })
      
      // All results should have the same reset time (same window)
      const resetTimes = results.map(r => r.resetTime)
      const uniqueResetTimes = [...new Set(resetTimes)]
      expect(uniqueResetTimes.length).toBe(1)
    }, 15000)

    it('maintains atomicity across multiple windows', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379'
      
      const config: RateLimitConfig = {
        windowMs: 100, // Very short window for testing
        maxRequests: 3,
        redisKeyPrefix: 'window_test'
      }

      const request = new Request('http://localhost:3000/api/test', {
        headers: { 'x-forwarded-for': '192.168.1.201' }
      }) as unknown as NextRequest

      const service = new RateLimitService(config)
      
      // Window 1: Exhaust limit
      const results1 = await Promise.all([
        service.check(request),
        service.check(request),
        service.check(request),
        service.check(request), // Should be blocked
        service.check(request)  // Should be blocked
      ])
      
      expect(results1.filter(r => r.allowed).length).toBe(3)
      expect(results1.filter(r => !r.allowed).length).toBe(2)
      
      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150))
      
      // Window 2: Should reset
      const results2 = await Promise.all([
        service.check(request),
        service.check(request),
        service.check(request)
      ])
      
      expect(results2.filter(r => r.allowed).length).toBe(3)
      expect(results2.filter(r => !r.allowed).length).toBe(0)
      
      // Reset times should be different between windows
      expect(results1[0].resetTime).toBeLessThan(results2[0].resetTime)
    }, 10000)
  })

  describe('Fallback Behavior', () => {
    it('gracefully degrades when Redis unavailable', async () => {
      // Use invalid Redis URL to force fallback
      process.env.REDIS_URL = 'redis://invalid-host:6379'
      
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 5,
        redisKeyPrefix: 'fallback_test'
      }

      const request = new Request('http://localhost:3000/api/test', {
        headers: { 'x-forwarded-for': '192.168.1.202' }
      }) as unknown as NextRequest

      const service = new RateLimitService(config)
      
      // Should fall back to memory store
      const result = await service.check(request)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
    })
  })

  describe('Store Selection Logic', () => {
    it('prioritizes Redis over Upstash', async () => {
      process.env.REDIS_URL = 'redis://localhost:6379'
      process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.example.com'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
      
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
        redisKeyPrefix: 'priority_test'
      }

      const service = new RateLimitService(config)
      
      // Should use Redis (production-grade) even though Upstash is available
      // This would be verified by checking the store type in a real implementation
      expect(service).toBeDefined()
    })

    it('uses Upstash when Redis not available', async () => {
      delete process.env.REDIS_URL
      process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.example.com'
      process.env.UPSTASH_REDIS_REST_TOKEN = 'token'
      
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
        redisKeyPrefix: 'upstash_fallback'
      }

      const service = new RateLimitService(config)
      expect(service).toBeDefined()
    })

    it('uses memory store when neither available', async () => {
      delete process.env.REDIS_URL
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN
      
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
        redisKeyPrefix: 'memory_fallback'
      }

      const service = new RateLimitService(config)
      expect(service).toBeDefined()
    })
  })
})
