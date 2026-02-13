'use client'

import React from 'react'

interface AIOperationsProps {
  activeTab: string
  setActiveTab: (tab: string) => void
  prompt: string
  setPrompt: (prompt: string) => void
  isGenerating: boolean
  settings: any
  setSettings: (settings: any) => void
  availableModels: any
  contentTypes: any
  isModelDropdownOpen: boolean
  setIsModelDropdownOpen: (open: boolean) => void
}

const AIOperations: React.FC<AIOperationsProps> = ({
  activeTab,
  setActiveTab,
  prompt,
  setPrompt,
  isGenerating,
  settings,
  setSettings,
  availableModels,
  contentTypes,
  isModelDropdownOpen,
  setIsModelDropdownOpen,
}) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">AI Operations</h2>
      <div className="space-y-4">
        <div className="flex gap-2">
          {Object.entries(contentTypes).map(([key, type]: [string, any]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-lg ${
                activeTab === key
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              {type.icon} {type.label}
            </button>
          ))}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={contentTypes[activeTab]?.placeholder}
          className="w-full h-32 p-4 border rounded-lg dark:bg-gray-700 dark:text-white"
        />
        <button
          disabled={isGenerating}
          className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-semibold"
        >
          {isGenerating ? 'Generating...' : 'Generate'}
        </button>
      </div>
    </div>
  )
}

export default AIOperations
