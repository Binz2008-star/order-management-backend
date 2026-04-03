import { RateLimitStore, RateLimitResult } from './rate-limit-store'
import { logger } from './logger'

export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>()

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now()
    const record = this.store.get(key)

    if (!record || now > record.resetTime) {
      const newRecord = {
        count: 1,
        resetTime: now + windowMs
      }
      this.store.set(key, newRecord)
      
      return {
        allowed: true,
        remaining: limit - 1,
        resetTime: newRecord.resetTime
      }
    }

    const updatedRecord = {
      count: record.count + 1,
      resetTime: record.resetTime
    }
    this.store.set(key, updatedRecord)

    const allowed = updatedRecord.count <= limit
    const remaining = Math.max(0, limit - updatedRecord.count)

    if (!allowed) {
      logger.warn('Rate limit exceeded (memory store)', {
        key,
        count: updatedRecord.count,
        limit
      })
    }

    return {
      allowed,
      remaining,
      resetTime: updatedRecord.resetTime
    }
  }

  async reset(key: string): Promise<boolean> {
    this.store.delete(key)
    return true
  }

  async getStats(key: string): Promise<{
    current: number
    limit: number
    resetTime: number
  } | null> {
    const record = this.store.get(key)
    if (!record) return null

    return {
      current: record.count,
      limit: 0, // Not tracked in memory store
      resetTime: record.resetTime
    }
  }

  // Cleanup expired entries (optional maintenance)
  cleanup(): void {
    const now = Date.now()
    for (const [key, record] of this.store.entries()) {
      if (now > record.resetTime) {
        this.store.delete(key)
      }
    }
  }
}
