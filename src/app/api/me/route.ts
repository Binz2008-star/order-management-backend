import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/server/lib/auth'

async function getMe(request: NextRequest) {
  try {
    const user = await getCurrentUser(request)

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        sellerId: user.sellerId,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid token' },
      { status: 401 }
    )
  }
}

export const GET = getMe
