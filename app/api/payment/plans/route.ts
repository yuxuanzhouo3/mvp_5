import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    // Mock payment plans - in production, these would come from Stripe
    const plans = [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        credits: 10,
        features: ['Basic text generation', 'Standard support'],
        popular: false
      },
      {
        id: 'starter',
        name: 'Starter',
        price: 9.99,
        credits: 100,
        features: ['All text generation', 'Image generation', 'Email support'],
        popular: true
      },
      {
        id: 'pro',
        name: 'Professional',
        price: 29.99,
        credits: 500,
        features: ['All generation types', 'Priority support', 'API access'],
        popular: false
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 99.99,
        credits: 2000,
        features: ['Unlimited generation', 'Dedicated support', 'Custom integrations'],
        popular: false
      }
    ]

    return NextResponse.json({ plans })
  } catch (error) {
    console.error('Payment plans error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payment plans' },
      { status: 500 }
    )
  }
} 