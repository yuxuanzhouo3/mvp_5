'use client'

import React from 'react'
import ThemeToggle from './ThemeToggle'

interface OperationsDashboardProps {
  generations: any[]
  isDark: boolean
  setIsDark: (dark: boolean) => void
}

const OperationsDashboard: React.FC<OperationsDashboardProps> = ({
  generations,
  isDark,
  setIsDark,
}) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h2>
        <ThemeToggle isDark={isDark} setIsDark={setIsDark} />
      </div>
      <div className="space-y-4">
        <div className="p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Recent Generations</h3>
          {generations.length === 0 ? (
            <p className="text-gray-600 dark:text-gray-400">No generations yet</p>
          ) : (
            <div className="space-y-2">
              {generations.map((gen) => (
                <div key={gen.id} className="p-2 bg-white dark:bg-gray-600 rounded">
                  <p className="text-sm text-gray-900 dark:text-white">{gen.type}: {gen.prompt}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default OperationsDashboard
