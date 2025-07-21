'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface SystemStats {
  totalUsers: number
  activeUsers: number
  totalGenerations: number
  totalRevenue: number
  systemHealth: 'healthy' | 'warning' | 'critical'
}

interface User {
  id: string
  email: string
  username: string
  full_name: string
  credits: number
  subscription_tier: string
  created_at: string
  last_login: string
  is_active: boolean
}

interface OperationsDashboardProps {
  user: any
  isAdmin?: boolean
}

const OperationsDashboard: React.FC<OperationsDashboardProps> = ({ user, isAdmin = false }) => {
  const [showDashboard, setShowDashboard] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [systemStats, setSystemStats] = useState<SystemStats>({
    totalUsers: 0,
    activeUsers: 0,
    totalGenerations: 0,
    totalRevenue: 0,
    systemHealth: 'healthy'
  })
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // User management states
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showUserModal, setShowUserModal] = useState(false)

  // System monitoring states
  const [systemAlerts, setSystemAlerts] = useState<any[]>([])
  const [performanceMetrics, setPerformanceMetrics] = useState({
    cpuUsage: 45,
    memoryUsage: 62,
    diskUsage: 78,
    networkLatency: 120
  })

  useEffect(() => {
    if (showDashboard && isAdmin) {
      loadSystemStats()
      loadUsers()
      loadSystemAlerts()
    }
  }, [showDashboard, isAdmin])

  const loadSystemStats = async () => {
    try {
      // Load total users
      const { count: totalUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })

      // Load active users (logged in last 7 days)
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      
      const { count: activeUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('last_login', sevenDaysAgo.toISOString())

      // Load total generations
      const { count: totalGenerations } = await supabase
        .from('generations')
        .select('*', { count: 'exact', head: true })

      // Calculate total revenue (simulated)
      const totalRevenue = 12345.67

      setSystemStats({
        totalUsers: totalUsers || 0,
        activeUsers: activeUsers || 0,
        totalGenerations: totalGenerations || 0,
        totalRevenue,
        systemHealth: 'healthy'
      })
    } catch (error) {
      console.error('Load system stats error:', error)
    }
  }

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      setUsers(data || [])
    } catch (error) {
      console.error('Load users error:', error)
    }
  }

  const loadSystemAlerts = async () => {
    // Simulate system alerts
    const alerts = [
      {
        id: 1,
        type: 'warning',
        message: 'High memory usage detected',
        timestamp: new Date().toISOString()
      },
      {
        id: 2,
        type: 'info',
        message: 'System backup completed successfully',
        timestamp: new Date(Date.now() - 3600000).toISOString()
      }
    ]
    setSystemAlerts(alerts)
  }

  const updateUserStatus = async (userId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_active: isActive })
        .eq('id', userId)

      if (error) throw error

      // Update local state
      setUsers(users.map(user => 
        user.id === userId ? { ...user, is_active: isActive } : user
      ))

      alert(`User ${isActive ? 'activated' : 'deactivated'} successfully`)
    } catch (error) {
      console.error('Update user status error:', error)
      alert('Failed to update user status')
    }
  }

  const addUserCredits = async (userId: string, credits: number) => {
    try {
      const user = users.find(u => u.id === userId)
      if (!user) return

      const newCredits = user.credits + credits
      const { error } = await supabase
        .from('users')
        .update({ credits: newCredits })
        .eq('id', userId)

      if (error) throw error

      // Update local state
      setUsers(users.map(u => 
        u.id === userId ? { ...u, credits: newCredits } : u
      ))

      // Record transaction
      await supabase
        .from('credit_transactions')
        .insert({
          user_id: userId,
          type: 'admin_grant',
          amount: credits,
          description: 'Credits added by administrator',
          reference_id: `admin_${Date.now()}`
        })

      alert(`${credits} credits added to user successfully`)
    } catch (error) {
      console.error('Add credits error:', error)
      alert('Failed to add credits')
    }
  }

  const getSystemHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return 'text-green-600'
      case 'warning': return 'text-yellow-600'
      case 'critical': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getSystemHealthIcon = (health: string) => {
    switch (health) {
      case 'healthy': return '🟢'
      case 'warning': return '🟡'
      case 'critical': return '🔴'
      default: return '⚪'
    }
  }

  if (!isAdmin) {
    return null
  }

  return (
    <>
      {/* Operations Dashboard Button */}
      <button
        onClick={() => setShowDashboard(true)}
        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
      >
        Operations
      </button>

      {/* Operations Dashboard Modal */}
      {showDashboard && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-7xl h-[95vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold">Operations Dashboard</h2>
              <button
                onClick={() => setShowDashboard(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              {['overview', 'users', 'monitoring', 'analytics', 'settings'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 font-medium capitalize ${
                    activeTab === tab
                      ? 'text-blue-600 border-b-2 border-blue-500'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">System Overview</h3>
                  
                  {/* System Health */}
                  <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium">System Health</h4>
                      <div className="flex items-center space-x-2">
                        <span>{getSystemHealthIcon(systemStats.systemHealth)}</span>
                        <span className={getSystemHealthColor(systemStats.systemHealth)}>
                          {systemStats.systemHealth}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{systemStats.totalUsers}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Total Users</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">{systemStats.activeUsers}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Active Users</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{systemStats.totalGenerations.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Total Generations</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-orange-600">${systemStats.totalRevenue.toLocaleString()}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">Total Revenue</div>
                      </div>
                    </div>
                  </div>

                  {/* Performance Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <h4 className="font-medium mb-4">System Performance</h4>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>CPU Usage</span>
                            <span>{performanceMetrics.cpuUsage}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${performanceMetrics.cpuUsage}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Memory Usage</span>
                            <span>{performanceMetrics.memoryUsage}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${performanceMetrics.memoryUsage}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Disk Usage</span>
                            <span>{performanceMetrics.diskUsage}%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div
                              className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${performanceMetrics.diskUsage}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <h4 className="font-medium mb-4">Recent Alerts</h4>
                      <div className="space-y-2">
                        {systemAlerts.map((alert) => (
                          <div
                            key={alert.id}
                            className={`p-2 rounded text-sm ${
                              alert.type === 'warning' ? 'bg-yellow-100 text-yellow-800' :
                              alert.type === 'critical' ? 'bg-red-100 text-red-800' :
                              'bg-blue-100 text-blue-800'
                            }`}
                          >
                            <div className="flex justify-between">
                              <span>{alert.message}</span>
                              <span className="text-xs">
                                {new Date(alert.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Users Tab */}
              {activeTab === 'users' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">User Management</h3>
                  
                  <div className="bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-600">
                          <tr>
                            <th className="px-4 py-2 text-left">User</th>
                            <th className="px-4 py-2 text-left">Credits</th>
                            <th className="px-4 py-2 text-left">Plan</th>
                            <th className="px-4 py-2 text-left">Status</th>
                            <th className="px-4 py-2 text-left">Joined</th>
                            <th className="px-4 py-2 text-left">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {users.map((user) => (
                            <tr key={user.id} className="border-t border-gray-200 dark:border-gray-600">
                              <td className="px-4 py-2">
                                <div>
                                  <div className="font-medium">{user.full_name || user.username}</div>
                                  <div className="text-sm text-gray-500">{user.email}</div>
                                </div>
                              </td>
                              <td className="px-4 py-2">{user.credits}</td>
                              <td className="px-4 py-2 capitalize">{user.subscription_tier}</td>
                              <td className="px-4 py-2">
                                <span className={`px-2 py-1 text-xs rounded-full ${
                                  user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {user.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-sm">
                                {new Date(user.created_at).toLocaleDateString()}
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex space-x-2">
                                  <button
                                    onClick={() => {
                                      setSelectedUser(user)
                                      setShowUserModal(true)
                                    }}
                                    className="text-blue-600 hover:text-blue-800 text-sm"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => updateUserStatus(user.id, !user.is_active)}
                                    className={`text-sm ${
                                      user.is_active ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'
                                    }`}
                                  >
                                    {user.is_active ? 'Deactivate' : 'Activate'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Monitoring Tab */}
              {activeTab === 'monitoring' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">System Monitoring</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <h4 className="font-medium mb-4">Real-time Metrics</h4>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Network Latency</span>
                            <span>{performanceMetrics.networkLatency}ms</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div
                              className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${(performanceMetrics.networkLatency / 200) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>API Response Time</span>
                            <span>45ms</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: '45%' }}></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Error Rate</span>
                            <span>0.2%</span>
                          </div>
                          <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: '0.2%' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <h4 className="font-medium mb-4">Service Status</h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span>AI Generation Service</span>
                          <span className="text-green-600">● Online</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Payment Processing</span>
                          <span className="text-green-600">● Online</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Database</span>
                          <span className="text-green-600">● Online</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>File Storage</span>
                          <span className="text-green-600">● Online</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Analytics Tab */}
              {activeTab === 'analytics' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">Analytics & Reports</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <h4 className="font-medium mb-2">Revenue Analytics</h4>
                      <div className="text-2xl font-bold text-green-600">$12,345</div>
                      <div className="text-sm text-gray-500">This month</div>
                      <div className="text-xs text-green-600 mt-1">+15% from last month</div>
                    </div>
                    
                    <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <h4 className="font-medium mb-2">User Growth</h4>
                      <div className="text-2xl font-bold text-blue-600">+234</div>
                      <div className="text-sm text-gray-500">New users this month</div>
                      <div className="text-xs text-blue-600 mt-1">+8% from last month</div>
                    </div>
                    
                    <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                      <h4 className="font-medium mb-2">Generation Volume</h4>
                      <div className="text-2xl font-bold text-purple-600">45,678</div>
                      <div className="text-sm text-gray-500">Generations this month</div>
                      <div className="text-xs text-purple-600 mt-1">+12% from last month</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">System Settings</h3>
                  
                  <div className="bg-white dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                    <h4 className="font-medium mb-4">General Settings</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-2">Maintenance Mode</label>
                        <div className="flex items-center space-x-2">
                          <input type="checkbox" className="rounded" />
                          <span className="text-sm">Enable maintenance mode</span>
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-2">Auto-scaling</label>
                        <div className="flex items-center space-x-2">
                          <input type="checkbox" className="rounded" defaultChecked />
                          <span className="text-sm">Enable automatic scaling</span>
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-2">Backup Frequency</label>
                        <select className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700">
                          <option>Daily</option>
                          <option>Weekly</option>
                          <option>Monthly</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Edit Modal */}
      {showUserModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96">
            <h3 className="text-lg font-bold mb-4">Edit User: {selectedUser.full_name}</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Add Credits</label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    min="1"
                    placeholder="Amount"
                    className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                    id="creditAmount"
                  />
                  <button
                    onClick={() => {
                      const amount = parseInt((document.getElementById('creditAmount') as HTMLInputElement).value)
                      if (amount > 0) {
                        addUserCredits(selectedUser.id, amount)
                        setShowUserModal(false)
                      }
                    }}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => setShowUserModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default OperationsDashboard 