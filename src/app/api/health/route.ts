import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Basic database connectivity check
    const { prisma } = await import('../../../server/db/prisma')
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: 'v1.0.0',
      database: 'connected'
    })
  } catch (_error) {
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: 'v1.0.0',
      database: 'disconnected',
      error: 'Health check failed'
    }, { status: 503 })
  }
}
