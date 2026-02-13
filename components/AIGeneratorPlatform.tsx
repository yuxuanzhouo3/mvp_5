'use client'

import React, { useState } from 'react'
import AIOperations from './AIOperations'
import OperationsDashboard from './OperationsDashboard'
import Collapse from './Collapse'

interface Generation {
  id: string
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
  const [activeTab, setActiveTab] = useState('text')
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generations, setGenerations] = useState<Generation[]>([])
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [settings, setSettings] = useState({
    temperature: 0.7,
    maxTokens: 1000,
    model: 'auto'
  })

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
    }
  }

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
      placeholder: 'Describe the image you want to generate...',
      settings: ['model']
    },
    audio: {
      label: 'Audio',
      icon: '🎵',
      placeholder: 'Describe the audio you want to generate...',
      settings: ['model']
    },
    video: {
      label: 'Video',
      icon: '🎬',
      placeholder: 'Describe the video you want to generate...',
      settings: ['model']
    }
  }

  return (
    <div className={`min-h-screen ${isDark ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-center mb-2 bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            MornGPT Platform
          </h1>
          <p className="text-center text-gray-600 dark:text-gray-400">
            All-in-One AI Content Generation Platform
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <AIOperations
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              prompt={prompt}
              setPrompt={setPrompt}
              isGenerating={isGenerating}
              settings={settings}
              setSettings={setSettings}
              availableModels={availableModels}
              contentTypes={contentTypes}
              isModelDropdownOpen={isModelDropdownOpen}
              setIsModelDropdownOpen={setIsModelDropdownOpen}
            />
          </div>

          <div className="lg:col-span-1">
            <OperationsDashboard
              generations={generations}
              isDark={isDark}
              setIsDark={setIsDark}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default AIGeneratorPlatform
