import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('credits')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('Database fetch error:', error)
        // If database tables don't exist or connection fails, return mock data
        if (error.code === '42P01' || error.message?.includes('fetch failed')) {
          return NextResponse.json({
            credits: 100,
            subscription_tier: 'free'
          })
        }
        return NextResponse.json(
          { error: 'Failed to fetch user credits' },
          { status: 500 }
        )
      }

      return NextResponse.json({ credits: user?.credits || 0 })
    } catch (error) {
      console.error('Database connection error:', error)
      // Return mock data if database is not available
      return NextResponse.json({
        credits: 100,
        subscription_tier: 'free'
      })
    }
  } catch (error) {
    console.error('Fetch credits error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, credits } = body

    if (!userId || credits === undefined) {
      return NextResponse.json(
        { error: 'User ID and credits are required' },
        { status: 400 }
      )
    }

    const { data: user, error } = await supabase
      .from('users')
      .upsert({
        id: userId,
        credits: credits,
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Database update error:', error)
      return NextResponse.json(
        { error: 'Failed to update user credits' },
        { status: 500 }
      )
    }

    return NextResponse.json({ credits: user.credits })
  } catch (error) {
    console.error('Update credits error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 