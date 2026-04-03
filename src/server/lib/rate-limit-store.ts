import { NextRequest } from 'next/server'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
}

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  keyGenerator?: (request: NextRequest) => string
  redisUrl?: string
  redisKeyPrefix?: string
}

export interface RateLimitStore {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>
  reset(key: string): Promise<boolean>
  getStats(key: string): Promise<{
    current: number
    limit: number
    resetTime: number
  } | null>
}

export type FallbackPolicy = 'fail-closed' | 'degrade-memory' | 'allow-all'

export interface StoreConfig {
  type: 'memory' | 'redis' | 'upstash'
  fallbackPolicy: FallbackPolicy
  redisUrl?: string
  redisToken?: string
}
