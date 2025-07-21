'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AuthSystem from './AuthSystem'
import PaymentSystem from './PaymentSystem'
import ChatSystem from './ChatSystem'
import AIOperations from './AIOperations'
import OperationsDashboard from './OperationsDashboard'
import Collapse from './Collapse'

interface User {
  id: string
  email: string
  username?: string
  full_name?: string
  avatar_url?: string
  credits: number
  subscription_tier: string
}

interface Generation {
  id: string
  user_id: string
  type: string
  prompt: string
  result: string
  status: string
  created_at: string
  settings?: {
    model?: string
    temperature?: number
    maxTokens?: number
  }
}

const AIGeneratorPlatform: React.FC = () => {
  const [user, setUser] = useState<User | null>(null)
  const [activeTab, setActiveTab] = useState('text')
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generations, setGenerations] = useState<Generation[]>([])
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [settings, setSettings] = useState({
    temperature: 0.7,
    maxTokens: 1000,
    model: 'auto'
  })

  // Available models configuration with contextual prompts
  const availableModels = {
    'auto': {
      name: 'Auto',
      description: 'Automatically select the best model',
      icon: '🤖',
      color: 'bg-purple-500',
      defaultPrompt: 'Ask me anything...'
    },
    'gpt-4': {
      name: 'GPT-4',
      description: 'OpenAI\'s most advanced model',
      icon: '🧠',
      color: 'bg-green-500',
      defaultPrompt: 'Write a professional email about...'
    },
    'deepseek-r1': {
      name: 'DeepSeek R1',
      description: 'High-performance reasoning model',
      icon: '🔍',
      color: 'bg-blue-500',
      defaultPrompt: 'Analyze and explain...'
    },
    'gork': {
      name: 'Gork',
      description: 'Specialized for creative tasks',
      icon: '🎭',
      color: 'bg-orange-500',
      defaultPrompt: 'Create a creative story about...'
    },
    'morn-gpt': {
      name: 'MornGPT',
      description: 'Our custom fine-tuned model',
      icon: '⭐',
      color: 'bg-yellow-500',
      defaultPrompt: 'Generate content about...'
    }
  }

  // Content type configurations for editing/transforming
  const contentTypes = {
    text: {
      label: 'Text',
      icon: '📝',
      placeholder: 'Edit or transform your text...',
      settings: ['temperature', 'maxTokens', 'model']
    },
    image: {
      label: 'Image',
      icon: '🎨',
      placeholder: 'Edit or transform your image...',
      settings: ['size', 'style', 'quality']
    },
    audio: {
      label: 'Audio',
      icon: '🎵',
      placeholder: 'Edit or transform your audio...',
      settings: ['voice', 'speed', 'format']
    },
    video: {
      label: 'Video',
      icon: '🎬',
      placeholder: 'Edit or transform your video...',
      settings: ['duration', 'resolution', 'style']
    }
  }

  useEffect(() => {
    if (user) {
      loadGenerations()
    }
    
    // Check if user has a saved theme preference
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme) {
      setIsDark(savedTheme === 'dark')
    }
  }, [user])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.model-dropdown-container')) {
        setIsModelDropdownOpen(false)
      }
      if (!target.closest('.user-dropdown-container')) {
        const profileDropdown = document.getElementById('profile-dropdown');
        const authDropdown = document.getElementById('auth-dropdown');
        if (profileDropdown) profileDropdown.classList.add('hidden');
        if (authDropdown) authDropdown.classList.add('hidden');
      }
    }

    if (isModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isModelDropdownOpen])

  const loadGenerations = async () => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from('generations')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      setGenerations(data || [])
    } catch (error) {
      console.error('Load generations error:', error)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
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

  const handleGenerate = async () => {
    if (!prompt.trim()) return

    // If user is not logged in, show login prompt
    if (!user) {
      alert('Please log in to generate content and save your results.')
      return
    }

    setIsGenerating(true)

    try {
      // Check if user has enough credits
      if (user.credits < 1) {
        alert('Insufficient credits. Please purchase more credits to continue.')
        return
      }

      // Create generation record
      const { data: generation, error } = await supabase
        .from('generations')
        .insert({
          user_id: user.id,
          type: activeTab,
          prompt,
          result: '',
          status: 'processing',
          settings: {
            model: settings.model,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens
          }
        })
        .select()
        .single()

      if (error) throw error

      // Simulate generation process
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Update generation with result
      const result = `Edited/Transformed ${activeTab} content: "${prompt}" using ${availableModels[settings.model as keyof typeof availableModels]?.name || settings.model}`
      await supabase
        .from('generations')
        .update({
          result,
          status: 'completed',
          settings: {
            model: settings.model,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens
          }
        })
        .eq('id', generation.id)

      // Deduct credits
      const newCredits = user.credits - 1
      await supabase
        .from('users')
        .update({ credits: newCredits })
        .eq('id', user.id)

      // Update local state
      setUser({ ...user, credits: newCredits })
      setPrompt('')
      await loadGenerations()

    } catch (error) {
      console.error('Generation error:', error)
      alert('Failed to generate content. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCreditsUpdate = (newCredits: number) => {
    if (user) {
      setUser({ ...user, credits: newCredits })
    }
  }

  const handleModelChange = (newModel: string) => {
    const modelConfig = availableModels[newModel as keyof typeof availableModels]
    if (modelConfig) {
      setSettings({...settings, model: newModel})
      
      // Update prompt based on model and content type
      const contentTypeConfig = contentTypes[activeTab as keyof typeof contentTypes]
      if (contentTypeConfig) {
        const contextualPrompt = getContextualPrompt(newModel, activeTab)
        setPrompt(contextualPrompt)
      }
    }
    setIsModelDropdownOpen(false)
  }

  const getContextualPrompt = (model: string, contentType: string) => {
    const modelConfig = availableModels[model as keyof typeof availableModels]
    const contentTypeConfig = contentTypes[contentType as keyof typeof contentTypes]
    
    if (!modelConfig || !contentTypeConfig) return ''
    
    // Model-specific prompts for editing/transforming different content types
    const modelPrompts: { [key: string]: { [key: string]: string } } = {
      'auto': {
        text: 'Edit or transform your text...',
        image: 'Edit or transform your image...',
        audio: 'Edit or transform your audio...',
        video: 'Edit or transform your video...'
      },
      'gpt-4': {
        text: 'Edit this text to be more professional...',
        image: 'Transform this image to be more detailed...',
        audio: 'Edit this audio to be more professional...',
        video: 'Transform this video script to be more engaging...'
      },
      'deepseek-r1': {
        text: 'Analyze and improve this text...',
        image: 'Transform this image into a technical diagram...',
        audio: 'Edit this audio to be more educational...',
        video: 'Transform this video to be more analytical...'
      },
      'gork': {
        text: 'Make this text more creative and artistic...',
        image: 'Transform this image to be more artistic...',
        audio: 'Make this audio more creative and expressive...',
        video: 'Transform this video to be more creative...'
      },
      'morn-gpt': {
        text: 'Personalize and customize this text...',
        image: 'Transform this image with custom styling...',
        audio: 'Customize this audio with personal touches...',
        video: 'Transform this video with personalized content...'
      }
    }
    
    return modelPrompts[model]?.[contentType] || modelConfig.defaultPrompt
  }

  const handleContentTypeChange = (newContentType: string) => {
    setActiveTab(newContentType)
    
    // Update prompt based on new content type and current model
    const contextualPrompt = getContextualPrompt(settings.model, newContentType)
    setPrompt(contextualPrompt)
  }

  const isAdmin = user?.subscription_tier === 'admin'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                MornGPT
              </h1>
              {user && (
                <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                  <span>Credits: {user.credits}</span>
                  <span>•</span>
                  <span className="capitalize">{user.subscription_tier}</span>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-4">
              {user && (
                <>
                  <PaymentSystem user={user} onCreditsUpdate={handleCreditsUpdate} />
                  <AIOperations user={user} />
                  {isAdmin && <OperationsDashboard user={user} isAdmin={isAdmin} />}
                </>
              )}
              
              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              
              {/* Integrated User Box */}
              <div className="relative user-dropdown-container">
                {user ? (
                  // Logged in user
                  <div className="relative">
                    <button
                      onClick={() => {
                        const profileDropdown = document.getElementById('profile-dropdown');
                        if (profileDropdown) {
                          profileDropdown.classList.toggle('hidden');
                        }
                      }}
                      className="flex items-center space-x-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    >
                      <img
                        src={user.avatar_url || '/default-avatar.png'}
                        alt="Avatar"
                        className="w-6 h-6 rounded-full"
                      />
                      <span>{user.full_name || user.username || 'User'}</span>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {/* Profile Dropdown */}
                    <div
                      id="profile-dropdown"
                      className="hidden absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 z-50"
                    >
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
                            onClick={() => {
                              const profileDropdown = document.getElementById('profile-dropdown');
                              if (profileDropdown) {
                                profileDropdown.classList.add('hidden');
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 rounded"
                          >
                            Edit Profile
                          </button>
                          <button
                            onClick={() => {
                              toggleTheme();
                              const profileDropdown = document.getElementById('profile-dropdown');
                              if (profileDropdown) {
                                profileDropdown.classList.add('hidden');
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 rounded flex items-center space-x-2"
                          >
                            {isDark ? (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                              </svg>
                            )}
                            <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
                          </button>
                          <button
                            onClick={() => {
                              supabase.auth.signOut();
                              setUser(null);
                              const profileDropdown = document.getElementById('profile-dropdown');
                              if (profileDropdown) {
                                profileDropdown.classList.add('hidden');
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          >
                            Sign Out
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Not logged in
                  <div className="relative">
                    <button
                      onClick={() => {
                        const authDropdown = document.getElementById('auth-dropdown');
                        if (authDropdown) {
                          authDropdown.classList.toggle('hidden');
                        }
                      }}
                      className="flex items-center space-x-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    >
                      <span>User</span>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {/* Auth Dropdown */}
                    <div
                      id="auth-dropdown"
                      className="hidden absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-700 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 z-50"
                    >
                      <div className="p-3 space-y-2">
                        <button
                          onClick={() => {
                            setShowLoginModal(true);
                            const authDropdown = document.getElementById('auth-dropdown');
                            if (authDropdown) {
                              authDropdown.classList.add('hidden');
                            }
                          }}
                          className="w-full px-3 py-2 text-sm font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                        >
                          Login
                        </button>
                        <button
                          onClick={() => {
                            setShowRegisterModal(true);
                            const authDropdown = document.getElementById('auth-dropdown');
                            if (authDropdown) {
                              authDropdown.classList.add('hidden');
                            }
                          }}
                          className="w-full px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          Register
                        </button>
                        <button
                          onClick={() => {
                            toggleTheme();
                            const authDropdown = document.getElementById('auth-dropdown');
                            if (authDropdown) {
                              authDropdown.classList.add('hidden');
                            }
                          }}
                          className="w-full px-3 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center space-x-2"
                        >
                          {isDark ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                            </svg>
                          )}
                          <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {user ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Panel - Generation Interface */}
            <div className="lg:col-span-2 space-y-6">
              {/* Content Type Tabs with Collapse */}
              <Collapse title="Choose content type to change" defaultOpen={true}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(contentTypes).map(([key, config]) => (
                    <button
                      key={key}
                      onClick={() => handleContentTypeChange(key)}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        activeTab === key
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      <div className="text-2xl mb-2">{config.icon}</div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {config.label}
                      </div>
                    </button>
                  ))}
                </div>
              </Collapse>



              {/* Generation Interface */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="p-6">
                  <div className="space-y-4">
                    {/* Model Selection Header */}
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        {contentTypes[activeTab as keyof typeof contentTypes].label}
                      </label>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">Model:</span>
                        <div className="relative model-dropdown-container">
                          <button
                            onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                            className={`flex items-center space-x-2 px-3 py-1.5 text-sm border rounded-lg transition-colors ${
                              settings.model === 'auto' 
                                ? 'border-purple-300 bg-purple-50 dark:bg-purple-900/20 text-purple-900 dark:text-purple-100' 
                                : settings.model === 'gpt-4'
                                ? 'border-green-300 bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-100'
                                : settings.model === 'deepseek-r1'
                                ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100'
                                : settings.model === 'gork'
                                ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20 text-orange-900 dark:text-orange-100'
                                : settings.model === 'morn-gpt'
                                ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-100'
                                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600'
                            }`}
                          >
                            <div className={`w-2 h-2 rounded-full ${availableModels[settings.model as keyof typeof availableModels]?.color}`}></div>
                            <span>{availableModels[settings.model as keyof typeof availableModels]?.name}</span>
                            <svg className={`w-4 h-4 transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          
                          {/* Model Selection Dropdown */}
                          {isModelDropdownOpen && (
                            <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-10">
                              <div className="p-2 space-y-1">
                                {Object.entries(availableModels).map(([key, model]) => (
                                  <button
                                    key={key}
                                    onClick={() => handleModelChange(key)}
                                    className={`w-full flex items-center space-x-3 p-2 rounded text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors ${
                                      settings.model === key ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                                    }`}
                                  >
                                    <div className={`w-3 h-3 rounded-full ${model.color}`}></div>
                                    <div className="text-lg">{model.icon}</div>
                                    <div>
                                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                                        {model.name}
                                      </div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {model.description}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder={getContextualPrompt(settings.model, activeTab)}
                        rows={6}
                        className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* Settings with Collapse */}
                    <Collapse title="Advanced Settings" defaultOpen={false}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Temperature
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={settings.temperature}
                            onChange={(e) => setSettings({...settings, temperature: parseFloat(e.target.value)})}
                            className="w-full"
                          />
                          <div className="text-xs text-gray-500 mt-1">{settings.temperature}</div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Max Tokens
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="4000"
                            value={settings.maxTokens}
                            onChange={(e) => setSettings({...settings, maxTokens: parseInt(e.target.value)})}
                            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          />
                        </div>
                      </div>
                      <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          <strong>Selected Model:</strong> {availableModels[settings.model as keyof typeof availableModels]?.name || settings.model}
                        </div>
                      </div>
                    </Collapse>

                    <button
                      onClick={handleGenerate}
                      disabled={isGenerating || !prompt.trim() || user.credits < 1}
                      className="w-full py-3 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isGenerating ? (
                        <div className="flex items-center justify-center space-x-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>Generating with {availableModels[settings.model as keyof typeof availableModels]?.name}...</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span>Edit/Transform {contentTypes[activeTab as keyof typeof contentTypes].label} (1 credit)</span>
                          <div className="flex items-center space-x-2">
                            <div className={`w-2 h-2 rounded-full ${availableModels[settings.model as keyof typeof availableModels]?.color}`}></div>
                            <span className="text-sm">{availableModels[settings.model as keyof typeof availableModels]?.name}</span>
                          </div>
                        </div>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Panel - History & Chat */}
            <div className="space-y-6">
              {/* Generation History */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Recent Edits & Transformations
                  </h3>
                </div>
                <div className="p-4 max-h-96 overflow-y-auto">
                  {generations.length > 0 ? (
                    <div className="space-y-3">
                      {generations.map((generation) => (
                        <div
                          key={generation.id}
                          className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                                {generation.type}
                              </span>
                              {generation.settings?.model && (
                                <div className="flex items-center space-x-1">
                                  <div className={`w-2 h-2 rounded-full ${availableModels[generation.settings.model as keyof typeof availableModels]?.color || 'bg-gray-400'}`}></div>
                                  <span className="text-xs text-gray-500">
                                    {availableModels[generation.settings.model as keyof typeof availableModels]?.name || generation.settings.model}
                                  </span>
                                </div>
                              )}
                            </div>
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              generation.status === 'completed' ? 'bg-green-100 text-green-800' :
                              generation.status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {generation.status}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                            {generation.prompt.substring(0, 100)}...
                          </div>
                          <div className="text-xs text-gray-500">
                            {new Date(generation.created_at).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                      <div className="text-4xl mb-2">✏️</div>
                      <p>No edits yet</p>
                      <p className="text-sm">Start editing or transforming content to see your history here</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Quick Actions
                  </h3>
                </div>
                <div className="p-4 space-y-2">
                  <button className="w-full text-left p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    📊 View Analytics
                  </button>
                  <button className="w-full text-left p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    ⚙️ Settings
                  </button>
                  <button className="w-full text-left p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    📚 Templates
                  </button>
                  <button className="w-full text-left p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    💳 Billing
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ChatGPT-style Welcome Screen for Non-Authenticated Users */
          <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
            <div className="max-w-4xl w-full text-center">
              {/* Main Branding */}
              <h1 className="text-6xl font-bold text-gray-900 dark:text-white mb-2">
                MornGPT
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
                Edit and transform your content with AI
              </p>
              
              {/* Content Type Selection with Collapse */}
              <div className="mb-8 max-w-2xl mx-auto">
                <Collapse title="Choose content type to change" defaultOpen={true}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(contentTypes).map(([key, config]) => (
                      <button
                        key={key}
                        onClick={() => handleContentTypeChange(key)}
                        className={`p-4 rounded-lg border-2 transition-all ${
                          activeTab === key
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                        }`}
                      >
                        <div className="text-2xl mb-2">{config.icon}</div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {config.label}
                        </div>
                      </button>
                    ))}
                  </div>
                </Collapse>
              </div>



              {/* Main Input Area */}
              <div className="max-w-3xl mx-auto mb-8">
                <div className="relative">
                  {/* Model Selection for Non-Authenticated Users */}
                  <div className="absolute top-3 right-3 z-10">
                    <div className="relative model-dropdown-container">
                      <button
                        onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                        className={`flex items-center space-x-2 px-2 py-1 text-xs border rounded transition-colors ${
                          settings.model === 'auto' 
                            ? 'border-purple-300 bg-purple-50 dark:bg-purple-900/20 text-purple-900 dark:text-purple-100' 
                            : settings.model === 'gpt-4'
                            ? 'border-green-300 bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-100'
                            : settings.model === 'deepseek-r1'
                            ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100'
                            : settings.model === 'gork'
                            ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20 text-orange-900 dark:text-orange-100'
                            : settings.model === 'morn-gpt'
                            ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-100'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                      >
                        <div className={`w-2 h-2 rounded-full ${availableModels[settings.model as keyof typeof availableModels]?.color}`}></div>
                        <span>{availableModels[settings.model as keyof typeof availableModels]?.name}</span>
                        <svg className={`w-3 h-3 transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isModelDropdownOpen && (
                        <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg">
                          <div className="p-2 space-y-1">
                            {Object.entries(availableModels).map(([key, model]) => (
                              <button
                                key={key}
                                onClick={() => handleModelChange(key)}
                                className={`w-full flex items-center space-x-2 p-2 rounded text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors ${
                                  settings.model === key ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                                }`}
                              >
                                <div className={`w-2 h-2 rounded-full ${model.color}`}></div>
                                <div className="text-sm">{model.icon}</div>
                                <div>
                                  <div className="text-xs font-medium text-gray-900 dark:text-white">
                                    {model.name}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={getContextualPrompt(settings.model, activeTab)}
                    rows={4}
                    className="w-full p-4 pr-24 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                  <button
                    onClick={handleGenerate}
                    disabled={!prompt.trim()}
                    className="absolute right-3 bottom-3 p-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                    title={`Generate with ${availableModels[settings.model as keyof typeof availableModels]?.name || settings.model}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Suggestion Buttons with Collapse */}
              <div className="max-w-4xl mx-auto">
                <Collapse title="Generate new content" defaultOpen={false}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <button
                      onClick={() => setPrompt("Write a professional email about...")}
                      className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <div className="text-lg mb-1">📧</div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">Write Email</div>
                    </button>
                    <button
                      onClick={() => setPrompt("Create a social media post about...")}
                      className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <div className="text-lg mb-1">📱</div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">Social Media</div>
                    </button>
                    <button
                      onClick={() => setPrompt("Generate an image of...")}
                      className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <div className="text-lg mb-1">🎨</div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">Generate Image</div>
                    </button>
                    <button
                      onClick={() => setPrompt("Create a video script about...")}
                      className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <div className="text-lg mb-1">🎬</div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">Video Script</div>
                    </button>
                  </div>
                </Collapse>
              </div>

              {/* Auth Notice */}
              <div className="mt-8 text-gray-500 dark:text-gray-400 text-sm">
                Sign in to save your edits and transformations and access advanced features
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Chat System */}
      {user && <ChatSystem user={user} />}

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">Sign In</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              // Implement login logic here
              alert('Login functionality - implement with your auth system');
              setShowLoginModal(false);
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <input
                  type="password"
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              
              {/* Forgot Password Link */}
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => {
                    setShowLoginModal(false);
                    setShowResetPasswordModal(true);
                  }}
                  className="text-sm text-blue-500 hover:text-blue-600"
                >
                  Forgot Password?
                </button>
              </div>

              {/* Google Sign In */}
              <button
                type="button"
                onClick={() => {
                  // TODO: Implement Google sign in
                  alert('Google sign in functionality - implement with your auth system');
                }}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>Continue with Google</span>
              </button>

              <div className="flex space-x-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setShowLoginModal(false)}
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
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">Create Account</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              // Implement register logic here
              alert('Register functionality - implement with your auth system');
              setShowRegisterModal(false);
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <input
                  type="password"
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Username</label>
                <input
                  type="text"
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>

              {/* Google Sign Up */}
              <button
                type="button"
                onClick={() => {
                  // TODO: Implement Google sign up
                  alert('Google sign up functionality - implement with your auth system');
                }}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>Sign up with Google</span>
              </button>

              <div className="flex space-x-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96">
            <h2 className="text-xl font-bold mb-4">Reset Password</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Enter your email address and we'll send you a link to reset your password.
            </p>
            <form onSubmit={(e) => {
              e.preventDefault();
              // TODO: Implement reset password logic
              alert('Reset password functionality - implement with your auth system');
              setShowResetPasswordModal(false);
            }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                  required
                />
              </div>
              
              <div className="flex space-x-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Send Reset Link
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetPasswordModal(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
              
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetPasswordModal(false);
                    setShowLoginModal(true);
                  }}
                  className="text-sm text-blue-500 hover:text-blue-600"
                >
                  Back to Sign In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AIGeneratorPlatform 