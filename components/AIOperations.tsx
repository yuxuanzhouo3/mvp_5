'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface AIModel {
  id: string
  name: string
  type: 'text' | 'image' | 'audio' | 'video'
  provider: string
  cost_per_token: number
  max_tokens: number
  is_active: boolean
}

interface BatchJob {
  id: string
  user_id: string
  type: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  total_items: number
  completed_items: number
  created_at: string
  updated_at: string
}

interface AIOperationsProps {
  user: any
}

const AIOperations: React.FC<AIOperationsProps> = ({ user }) => {
  const [showOperations, setShowOperations] = useState(false)
  const [activeTab, setActiveTab] = useState('models')
  const [models, setModels] = useState<AIModel[]>([])
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([])
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Batch processing states
  const [batchInputs, setBatchInputs] = useState<string>('')
  const [batchType, setBatchType] = useState('text')
  const [batchModel, setBatchModel] = useState('')

  // Model configuration states
  const [modelConfig, setModelConfig] = useState({
    temperature: 0.7,
    maxTokens: 1000,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0
  })

  useEffect(() => {
    if (showOperations) {
      loadModels()
      loadBatchJobs()
    }
  }, [showOperations])

  const loadModels = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_models')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (error) throw error
      setModels(data || [])
    } catch (error) {
      console.error('Load models error:', error)
    }
  }

  const loadBatchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from('batch_jobs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setBatchJobs(data || [])
    } catch (error) {
      console.error('Load batch jobs error:', error)
    }
  }

  const createBatchJob = async () => {
    if (!batchInputs.trim() || !batchModel) return

    setIsLoading(true)
    try {
      const inputs = batchInputs.split('\n').filter(input => input.trim())
      
      const { data, error } = await supabase
        .from('batch_jobs')
        .insert({
          user_id: user.id,
          type: batchType,
          status: 'pending',
          total_items: inputs.length,
          completed_items: 0,
          model_id: batchModel,
          inputs: inputs,
          config: modelConfig
        })
        .select()
        .single()

      if (error) throw error

      // Simulate batch processing
      setTimeout(() => {
        processBatchJob(data.id, inputs)
      }, 1000)

      setBatchJobs([data, ...batchJobs])
      setBatchInputs('')
      alert('Batch job created successfully!')
    } catch (error) {
      console.error('Create batch job error:', error)
      alert('Failed to create batch job.')
    } finally {
      setIsLoading(false)
    }
  }

  const processBatchJob = async (jobId: string, inputs: string[]) => {
    try {
      // Update status to processing
      await supabase
        .from('batch_jobs')
        .update({ status: 'processing' })
        .eq('id', jobId)

      // Simulate processing each input
      for (let i = 0; i < inputs.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 500)) // Simulate processing time
        
        // Update progress
        await supabase
          .from('batch_jobs')
          .update({ completed_items: i + 1 })
          .eq('id', jobId)
      }

      // Mark as completed
      await supabase
        .from('batch_jobs')
        .update({ status: 'completed' })
        .eq('id', jobId)

      // Reload batch jobs
      await loadBatchJobs()
    } catch (error) {
      console.error('Process batch job error:', error)
      
      // Mark as failed
      await supabase
        .from('batch_jobs')
        .update({ status: 'failed' })
        .eq('id', jobId)
    }
  }

  const testModel = async (model: AIModel) => {
    setSelectedModel(model)
    setIsLoading(true)

    try {
      // Simulate model testing
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      alert(`Model ${model.name} tested successfully!`)
    } catch (error) {
      console.error('Test model error:', error)
      alert('Failed to test model.')
    } finally {
      setIsLoading(false)
    }
  }

  const getModelCost = (model: AIModel, tokens: number) => {
    return (model.cost_per_token * tokens).toFixed(4)
  }

  return (
    <>
      {/* AI Operations Button */}
      <button
        onClick={() => setShowOperations(true)}
        className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
      >
        AI Operations
      </button>

      {/* AI Operations Modal */}
      {showOperations && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-6xl h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold">AI Operations Center</h2>
              <button
                onClick={() => setShowOperations(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              {['models', 'batch', 'config', 'analytics'].map((tab) => (
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
              {/* Models Tab */}
              {activeTab === 'models' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">Available AI Models</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {models.map((model) => (
                      <div
                        key={model.id}
                        className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-lg transition-shadow"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold">{model.name}</h4>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            model.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {model.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        
                        <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                          <div>Type: {model.type}</div>
                          <div>Provider: {model.provider}</div>
                          <div>Cost: ${model.cost_per_token}/token</div>
                          <div>Max Tokens: {model.max_tokens.toLocaleString()}</div>
                        </div>

                        <div className="mt-4 flex space-x-2">
                          <button
                            onClick={() => testModel(model)}
                            disabled={isLoading}
                            className="flex-1 px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50"
                          >
                            Test Model
                          </button>
                          <button
                            onClick={() => setSelectedModel(model)}
                            className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            Configure
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Batch Processing Tab */}
              {activeTab === 'batch' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">Batch Processing</h3>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Create Batch Job */}
                    <div className="space-y-4">
                      <h4 className="font-medium">Create New Batch Job</h4>
                      
                      <div>
                        <label className="block text-sm font-medium mb-2">Content Type</label>
                        <select
                          value={batchType}
                          onChange={(e) => setBatchType(e.target.value)}
                          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                        >
                          <option value="text">Text Generation</option>
                          <option value="image">Image Generation</option>
                          <option value="audio">Audio Generation</option>
                          <option value="video">Video Generation</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-2">AI Model</label>
                        <select
                          value={batchModel}
                          onChange={(e) => setBatchModel(e.target.value)}
                          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                        >
                          <option value="">Select a model</option>
                          {models
                            .filter(model => model.type === batchType)
                            .map(model => (
                              <option key={model.id} value={model.id}>
                                {model.name} (${model.cost_per_token}/token)
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-2">Inputs (one per line)</label>
                        <textarea
                          value={batchInputs}
                          onChange={(e) => setBatchInputs(e.target.value)}
                          rows={6}
                          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                          placeholder="Enter your prompts here, one per line..."
                        />
                      </div>

                      <button
                        onClick={createBatchJob}
                        disabled={isLoading || !batchInputs.trim() || !batchModel}
                        className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                      >
                        {isLoading ? 'Creating...' : 'Create Batch Job'}
                      </button>
                    </div>

                    {/* Batch Jobs List */}
                    <div className="space-y-4">
                      <h4 className="font-medium">Recent Batch Jobs</h4>
                      
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {batchJobs.map((job) => (
                          <div
                            key={job.id}
                            className="border border-gray-200 dark:border-gray-700 rounded-lg p-3"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">{job.type} Generation</span>
                              <span className={`px-2 py-1 text-xs rounded-full ${
                                job.status === 'completed' ? 'bg-green-100 text-green-800' :
                                job.status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                                job.status === 'failed' ? 'bg-red-100 text-red-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {job.status}
                              </span>
                            </div>
                            
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              <div>Progress: {job.completed_items}/{job.total_items}</div>
                              <div>Created: {new Date(job.created_at).toLocaleString()}</div>
                            </div>

                            {job.status === 'processing' && (
                              <div className="mt-2">
                                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                                  <div
                                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${(job.completed_items / job.total_items) * 100}%` }}
                                  ></div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Configuration Tab */}
              {activeTab === 'config' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">Model Configuration</h3>
                  
                  {selectedModel ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium">Configure: {selectedModel.name}</h4>
                        <button
                          onClick={() => setSelectedModel(null)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          Clear
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">Temperature</label>
                          <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={modelConfig.temperature}
                            onChange={(e) => setModelConfig({...modelConfig, temperature: parseFloat(e.target.value)})}
                            className="w-full"
                          />
                          <div className="text-sm text-gray-500 mt-1">{modelConfig.temperature}</div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-2">Max Tokens</label>
                          <input
                            type="number"
                            min="1"
                            max={selectedModel.max_tokens}
                            value={modelConfig.maxTokens}
                            onChange={(e) => setModelConfig({...modelConfig, maxTokens: parseInt(e.target.value)})}
                            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-2">Top P</label>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={modelConfig.topP}
                            onChange={(e) => setModelConfig({...modelConfig, topP: parseFloat(e.target.value)})}
                            className="w-full"
                          />
                          <div className="text-sm text-gray-500 mt-1">{modelConfig.topP}</div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-2">Frequency Penalty</label>
                          <input
                            type="range"
                            min="-2"
                            max="2"
                            step="0.1"
                            value={modelConfig.frequencyPenalty}
                            onChange={(e) => setModelConfig({...modelConfig, frequencyPenalty: parseFloat(e.target.value)})}
                            className="w-full"
                          />
                          <div className="text-sm text-gray-500 mt-1">{modelConfig.frequencyPenalty}</div>
                        </div>
                      </div>

                      <div className="pt-4">
                        <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                          Save Configuration
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 dark:text-gray-400">
                      Select a model to configure its parameters
                    </div>
                  )}
                </div>
              )}

              {/* Analytics Tab */}
              {activeTab === 'analytics' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold">AI Usage Analytics</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">1,234</div>
                      <div className="text-sm text-blue-600">Total Generations</div>
                    </div>
                    
                    <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">$45.67</div>
                      <div className="text-sm text-green-600">Total Cost</div>
                    </div>
                    
                    <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
                      <div className="text-2xl font-bold text-purple-600">89%</div>
                      <div className="text-sm text-purple-600">Success Rate</div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-medium">Model Usage</h4>
                    <div className="space-y-2">
                      {models.map((model) => (
                        <div key={model.id} className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded">
                          <span>{model.name}</span>
                          <span className="text-sm text-gray-500">156 uses</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default AIOperations 