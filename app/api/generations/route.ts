import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const limit = parseInt(searchParams.get('limit') || '10')

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      )
    }

    const { data: generations, error } = await supabase
      .from('generations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Database fetch error:', error)
      // If database tables don't exist, return mock data
      if (error.code === '42P01') {
        return NextResponse.json([
          {
            id: 'mock-generation-1',
            user_id: userId,
            type: 'text',
            prompt: 'Sample prompt',
            result: 'Sample generated content',
            status: 'completed',
            created_at: new Date().toISOString()
          }
        ])
      }
      return NextResponse.json(
        { error: 'Failed to fetch generations' },
        { status: 500 }
      )
    }

    return NextResponse.json(generations)
  } catch (error) {
    console.error('Fetch generations error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 