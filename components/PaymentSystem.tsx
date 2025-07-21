'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface SubscriptionPlan {
  id: number
  name: string
  tier: string
  monthly_price: number
  yearly_price: number
  credits_per_month: number
  features: any
}

interface PaymentSystemProps {
  user: any
  onCreditsUpdate: (credits: number) => void
}

const PaymentSystem: React.FC<PaymentSystemProps> = ({ user, onCreditsUpdate }) => {
  const [showPayment, setShowPayment] = useState(false)
  const [showSubscriptions, setShowSubscriptions] = useState(false)
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('card')
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')

  // Credit purchase states
  const [creditAmount, setCreditAmount] = useState(50)
  const [showCreditPurchase, setShowCreditPurchase] = useState(false)

  useEffect(() => {
    loadSubscriptionPlans()
  }, [])

  const loadSubscriptionPlans = async () => {
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('monthly_price')

      if (error) throw error
      setPlans(data || [])
    } catch (error) {
      console.error('Load plans error:', error)
    }
  }

  const handleCreditPurchase = async () => {
    if (!user) return

    setIsLoading(true)
    try {
      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Update user credits
      const newCredits = user.credits + creditAmount
      const { error } = await supabase
        .from('users')
        .update({ credits: newCredits })
        .eq('id', user.id)

      if (error) throw error

      // Record transaction
      await supabase
        .from('credit_transactions')
        .insert({
          user_id: user.id,
          type: 'purchase',
          amount: creditAmount,
          description: `Purchased ${creditAmount} credits`,
          reference_id: `purchase_${Date.now()}`
        })

      onCreditsUpdate(newCredits)
      setShowCreditPurchase(false)
      alert(`Successfully purchased ${creditAmount} credits!`)
    } catch (error) {
      console.error('Credit purchase error:', error)
      alert('Failed to purchase credits. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubscriptionUpgrade = async () => {
    if (!user || !selectedPlan) return

    setIsLoading(true)
    try {
      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000))

      const price = billingCycle === 'monthly' ? selectedPlan.monthly_price : selectedPlan.yearly_price
      const expiresAt = new Date()
      expiresAt.setMonth(expiresAt.getMonth() + (billingCycle === 'monthly' ? 1 : 12))

      // Update user subscription
      const { error } = await supabase
        .from('users')
        .update({
          subscription_tier: selectedPlan.tier,
          subscription_expires_at: expiresAt.toISOString(),
          credits: user.credits + selectedPlan.credits_per_month
        })
        .eq('id', user.id)

      if (error) throw error

      // Record transaction
      await supabase
        .from('credit_transactions')
        .insert({
          user_id: user.id,
          type: 'purchase',
          amount: selectedPlan.credits_per_month,
          description: `${selectedPlan.name} subscription - ${billingCycle}`,
          reference_id: `sub_${Date.now()}`
        })

      onCreditsUpdate(user.credits + selectedPlan.credits_per_month)
      setShowSubscriptions(false)
      alert(`Successfully upgraded to ${selectedPlan.name}!`)
    } catch (error) {
      console.error('Subscription error:', error)
      alert('Failed to upgrade subscription. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const creditPackages = [
    { amount: 50, price: 9.99, popular: false },
    { amount: 100, price: 17.99, popular: true },
    { amount: 250, price: 39.99, popular: false },
    { amount: 500, price: 69.99, popular: false }
  ]

  return (
    <>
      {/* Credit Purchase Button */}
      <button
        onClick={() => setShowCreditPurchase(true)}
        className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
      >
        Buy Credits
      </button>

      {/* Subscription Button */}
      <button
        onClick={() => setShowSubscriptions(true)}
        className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
      >
        Upgrade Plan
      </button>

      {/* Credit Purchase Modal */}
      {showCreditPurchase && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96 max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Purchase Credits</h2>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              {creditPackages.map((pkg) => (
                <div
                  key={pkg.amount}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    creditAmount === pkg.amount
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-blue-300'
                  } ${pkg.popular ? 'ring-2 ring-green-500' : ''}`}
                  onClick={() => setCreditAmount(pkg.amount)}
                >
                  {pkg.popular && (
                    <div className="text-xs bg-green-500 text-white px-2 py-1 rounded-full mb-2 inline-block">
                      Most Popular
                    </div>
                  )}
                  <div className="text-2xl font-bold">{pkg.amount}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">credits</div>
                  <div className="text-lg font-semibold">${pkg.price}</div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                >
                  <option value="card">Credit Card</option>
                  <option value="paypal">PayPal</option>
                  <option value="crypto">Cryptocurrency</option>
                </select>
              </div>

              <div className="flex justify-between items-center">
                <span className="font-medium">Total:</span>
                <span className="text-xl font-bold">
                  ${creditPackages.find(p => p.amount === creditAmount)?.price}
                </span>
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={handleCreditPurchase}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                >
                  {isLoading ? 'Processing...' : 'Purchase Credits'}
                </button>
                <button
                  onClick={() => setShowCreditPurchase(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Modal */}
      {showSubscriptions && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[600px] max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Choose Your Plan</h2>
            
            <div className="mb-4">
              <div className="flex space-x-4">
                <button
                  onClick={() => setBillingCycle('monthly')}
                  className={`px-4 py-2 rounded ${
                    billingCycle === 'monthly'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingCycle('yearly')}
                  className={`px-4 py-2 rounded ${
                    billingCycle === 'yearly'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  Yearly (Save 20%)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`p-6 border rounded-lg cursor-pointer transition-colors ${
                    selectedPlan?.id === plan.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-blue-300'
                  }`}
                  onClick={() => setSelectedPlan(plan)}
                >
                  <div className="text-xl font-bold mb-2">{plan.name}</div>
                  <div className="text-3xl font-bold mb-4">
                    ${billingCycle === 'monthly' ? plan.monthly_price : plan.yearly_price}
                    <span className="text-sm font-normal text-gray-600">/{billingCycle === 'monthly' ? 'mo' : 'year'}</span>
                  </div>
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center">
                      <span className="text-green-500 mr-2">✓</span>
                      {plan.credits_per_month} credits/month
                    </div>
                    {plan.features.max_generations_per_month && (
                      <div className="flex items-center">
                        <span className="text-green-500 mr-2">✓</span>
                        {plan.features.max_generations_per_month} generations/month
                      </div>
                    )}
                    {plan.features.priority_support && (
                      <div className="flex items-center">
                        <span className="text-green-500 mr-2">✓</span>
                        Priority Support
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {selectedPlan && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Plan:</span>
                  <span className="font-bold">{selectedPlan.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium">Billing:</span>
                  <span className="font-bold capitalize">{billingCycle}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-medium">Total:</span>
                  <span className="text-xl font-bold">
                    ${billingCycle === 'monthly' ? selectedPlan.monthly_price : selectedPlan.yearly_price}
                  </span>
                </div>

                <div className="flex space-x-2">
                  <button
                    onClick={handleSubscriptionUpgrade}
                    disabled={isLoading}
                    className="flex-1 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
                  >
                    {isLoading ? 'Processing...' : 'Upgrade Now'}
                  </button>
                  <button
                    onClick={() => setShowSubscriptions(false)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default PaymentSystem 