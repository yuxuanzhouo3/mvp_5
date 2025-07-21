'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Collapse from './Collapse'
import ThemeToggle from './ThemeToggle'

interface User {
  id: string
  email: string
  username?: string
  full_name?: string
  avatar_url?: string
  credits: number
  subscription_tier: string
}

interface AuthSystemProps {
  onUserChange: (user: User | null) => void
}

const AuthSystem: React.FC<AuthSystemProps> = ({ onUserChange }) => {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showLogin, setShowLogin] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [isDark, setIsDark] = useState(true)
  
  // Form states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)

  useEffect(() => {
    checkUser()
    // Check if user has a saved theme preference
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme) {
      setIsDark(savedTheme === 'dark')
    }
  }, [])

  const checkUser = async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        await loadUserProfile(authUser.id)
      }
    } catch (error) {
      console.error('Auth check error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadUserProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error

      const userProfile: User = {
        id: data.id,
        email: data.email,
        username: data.username,
        full_name: data.full_name,
        avatar_url: data.avatar_url,
        credits: data.credits,
        subscription_tier: data.subscription_tier
      }

      setUser(userProfile)
      onUserChange(userProfile)
    } catch (error) {
      console.error('Load profile error:', error)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) throw error

      if (data.user) {
        await loadUserProfile(data.user.id)
        setShowLogin(false)
        setEmail('')
        setPassword('')
      }
    } catch (error) {
      console.error('Login error:', error)
      alert('Login failed. Please check your credentials.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // Create auth user
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
            full_name: fullName
          }
        }
      })

      if (error) throw error

      if (data.user) {
        // Create user profile
        const { error: profileError } = await supabase
          .from('users')
          .insert({
            id: data.user.id,
            email,
            username,
            full_name: fullName,
            credits: 100,
            subscription_tier: 'free'
          })

        if (profileError) throw profileError

        await loadUserProfile(data.user.id)
        setShowRegister(false)
        setEmail('')
        setPassword('')
        setUsername('')
        setFullName('')
      }
    } catch (error) {
      console.error('Register error:', error)
      alert('Registration failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
      setUser(null)
      onUserChange(null)
      setShowProfile(false)
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const handleAvatarUpload = async (file: File) => {
    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${user?.id}-${Date.now()}.${fileExt}`
      const filePath = `avatars/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      // Update user profile
      const { error: updateError } = await supabase
        .from('users')
        .update({ avatar_url: publicUrl })
        .eq('id', user?.id)

      if (updateError) throw updateError

      // Reload user profile
      if (user) {
        await loadUserProfile(user.id)
      }
    } catch (error) {
      console.error('Avatar upload error:', error)
      alert('Failed to upload avatar.')
    }
  }

  const toggleTheme = () => {
    const newTheme = !isDark
    setIsDark(newTheme)
    localStorage.setItem('theme', newTheme ? 'dark' : 'light')
    
    // Toggle the dark class on the html element
    if (newTheme) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  if (isLoading) {
    return (
      <div className="fixed top-1 right-4 z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg px-4 py-2 shadow-lg">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed top-1 right-4 z-50">
      {user ? (
        // Logged in user
        <div className="flex items-center space-x-2">
          <div className="relative">
            <img
              src={user.avatar_url || '/default-avatar.png'}
              alt="Avatar"
              className="w-8 h-8 rounded-full cursor-pointer"
              onClick={() => setShowProfile(!showProfile)}
            />
            {showProfile && (
              <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700">
                <div className="p-4">
                  <div className="flex items-center space-x-3 mb-4">
                    <img
                      src={user.avatar_url || '/default-avatar.png'}
                      alt="Avatar"
                      className="w-12 h-12 rounded-full"
                    />
                    <div>
                      <div className="font-medium">{user.full_name || user.username}</div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </div>
                  </div>
                  
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Credits:</span>
                      <span className="font-medium">{user.credits}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Plan:</span>
                      <span className="font-medium capitalize">{user.subscription_tier}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={() => setShowProfile(false)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    >
                      Edit Profile
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // Not logged in - Single column with Collapse
        <Collapse title="User" defaultOpen={false} className="text-xs">
          <div className="space-y-1 min-w-[80px]">
            <button
              onClick={() => setShowLogin(true)}
              className="w-full px-2 py-1 text-xs font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            >
              Login
            </button>
            <button
              onClick={() => setShowRegister(true)}
              className="w-full px-2 py-1 text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Register
            </button>
            <button
              onClick={toggleTheme}
              className="w-full px-2 py-1 text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center space-x-1"
            >
              {isDark ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
              <span className="text-xs">{isDark ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </Collapse>
      )}

      {/* Login Modal */}
      {showLogin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">Login</h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div className="flex space-x-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {isLoading ? 'Logging in...' : 'Login'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogin(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Modal */}
      {showRegister && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">Register</h2>
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div className="flex space-x-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {isLoading ? 'Creating account...' : 'Register'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRegister(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AuthSystem 