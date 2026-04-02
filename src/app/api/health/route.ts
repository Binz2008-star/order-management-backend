import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Temporarily remove database check to test if SQLite is causing 401
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: 'v1.0.0',
      database: 'temporarily_disabled',
      message: 'Health check without database connectivity'
    })
  } catch (_error) {
    return NextResponse.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: 'v1.0.0',
      error: 'Health check failed'
    }, { status: 503 })
  }
}
