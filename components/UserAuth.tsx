'use client'

import React, { useState, useEffect } from 'react'

interface UserAuthProps {
  onUserChange: (userId: string | null) => void
}

const UserAuth: React.FC<UserAuthProps> = ({ onUserChange }) => {
  const [userId, setUserId] = useState<string | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    // Check for saved user ID
    const savedUserId = localStorage.getItem('userId')
    if (savedUserId) {
      setUserId(savedUserId)
      setIsLoggedIn(true)
      onUserChange(savedUserId)
    }
  }, [onUserChange])

  const handleLogin = () => {
    const newUserId = `user_${Date.now()}`
    setUserId(newUserId)
    setIsLoggedIn(true)
    localStorage.setItem('userId', newUserId)
    onUserChange(newUserId)
  }

  const handleLogout = () => {
    setUserId(null)
    setIsLoggedIn(false)
    localStorage.removeItem('userId')
    onUserChange(null)
  }

  return (
    <div className="fixed top-4 left-4 z-50">
      {isLoggedIn ? (
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            User: {userId?.slice(0, 8)}...
          </span>
          <button
            onClick={handleLogout}
            className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            Logout
          </button>
        </div>
      ) : (
        <button
          onClick={handleLogin}
          className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Login (Demo)
        </button>
      )}
    </div>
  )
}

export default UserAuth 