'use client'

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface Message {
  id: string
  content: string
  role: 'user' | 'assistant'
  timestamp: string
  conversation_id: string
}

interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

interface ChatSystemProps {
  user: any
}

const ChatSystem: React.FC<ChatSystemProps> = ({ user }) => {
  const [showChat, setShowChat] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showChat && user) {
      loadConversations()
    }
  }, [showChat, user])

  useEffect(() => {
    if (currentConversation) {
      loadMessages(currentConversation.id)
    }
  }, [currentConversation])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const loadConversations = async () => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })

      if (error) throw error
      setConversations(data || [])
    } catch (error) {
      console.error('Load conversations error:', error)
    }
  }

  const loadMessages = async (conversationId: string) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (error) throw error
      setMessages(data || [])
    } catch (error) {
      console.error('Load messages error:', error)
    }
  }

  const createNewConversation = async () => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          user_id: user.id,
          title: 'New Conversation',
          message_count: 0
        })
        .select()
        .single()

      if (error) throw error

      const newConversation: Conversation = {
        id: data.id,
        title: data.title,
        created_at: data.created_at,
        updated_at: data.updated_at,
        message_count: data.message_count
      }

      setConversations([newConversation, ...conversations])
      setCurrentConversation(newConversation)
      setMessages([])
    } catch (error) {
      console.error('Create conversation error:', error)
    }
  }

  const sendMessage = async () => {
    if (!inputMessage.trim() || !currentConversation) return

    const userMessage: Omit<Message, 'id' | 'timestamp'> = {
      content: inputMessage,
      role: 'user',
      conversation_id: currentConversation.id
    }

    setIsLoading(true)
    setInputMessage('')

    try {
      // Save user message
      const { data: savedMessage, error } = await supabase
        .from('messages')
        .insert(userMessage)
        .select()
        .single()

      if (error) throw error

      // Add to local state
      const newMessage: Message = {
        id: savedMessage.id,
        content: savedMessage.content,
        role: savedMessage.role,
        timestamp: savedMessage.created_at,
        conversation_id: savedMessage.conversation_id
      }

      setMessages([...messages, newMessage])

      // Simulate AI response
      setIsTyping(true)
      await new Promise(resolve => setTimeout(resolve, 1000))

      const aiResponse = await generateAIResponse(inputMessage)

      const aiMessage: Omit<Message, 'id' | 'timestamp'> = {
        content: aiResponse,
        role: 'assistant',
        conversation_id: currentConversation.id
      }

      // Save AI message
      const { data: savedAiMessage, error: aiError } = await supabase
        .from('messages')
        .insert(aiMessage)
        .select()
        .single()

      if (aiError) throw aiError

      // Add AI message to local state
      const newAiMessage: Message = {
        id: savedAiMessage.id,
        content: savedAiMessage.content,
        role: savedAiMessage.role,
        timestamp: savedAiMessage.created_at,
        conversation_id: savedAiMessage.conversation_id
      }

      setMessages(prev => [...prev, newAiMessage])

      // Update conversation
      await supabase
        .from('conversations')
        .update({
          title: inputMessage.substring(0, 50) + '...',
          message_count: messages.length + 2,
          updated_at: new Date().toISOString()
        })
        .eq('id', currentConversation.id)

      // Reload conversations to update the list
      await loadConversations()

    } catch (error) {
      console.error('Send message error:', error)
      alert('Failed to send message. Please try again.')
    } finally {
      setIsLoading(false)
      setIsTyping(false)
    }
  }

  const generateAIResponse = async (userMessage: string): Promise<string> => {
    // Simulate AI response generation
    const responses = [
      "I understand your question. Let me help you with that.",
      "That's an interesting point. Here's what I think about it...",
      "Based on your message, I can provide some insights...",
      "Thank you for sharing that. Here's my response...",
      "I appreciate your question. Let me break this down for you..."
    ]
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    return responses[Math.floor(Math.random() * responses.length)] + 
           " This is a simulated AI response. In a real implementation, this would be generated by an AI model like GPT-4 or similar."
  }

  const deleteConversation = async (conversationId: string) => {
    try {
      // Delete messages first
      await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId)

      // Delete conversation
      await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId)

      // Update local state
      setConversations(conversations.filter(c => c.id !== conversationId))
      
      if (currentConversation?.id === conversationId) {
        setCurrentConversation(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Delete conversation error:', error)
    }
  }

  return (
    <>
      {/* Chat Button */}
      <button
        onClick={() => setShowChat(true)}
        className="fixed bottom-4 right-4 z-40 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      {/* Chat Modal */}
      {showChat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-4xl h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold">AI Chat Assistant</h2>
              <button
                onClick={() => setShowChat(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar - Conversations */}
              <div className="w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col">
                <div className="p-4">
                  <button
                    onClick={createNewConversation}
                    className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    New Conversation
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {conversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={`p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        currentConversation?.id === conversation.id
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-r-2 border-blue-500'
                          : ''
                      }`}
                      onClick={() => setCurrentConversation(conversation)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{conversation.title}</div>
                          <div className="text-sm text-gray-500">
                            {new Date(conversation.updated_at).toLocaleDateString()}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteConversation(conversation.id)
                          }}
                          className="text-red-500 hover:text-red-700 ml-2"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Main Chat Area */}
              <div className="flex-1 flex flex-col">
                {currentConversation ? (
                  <>
                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                              message.role === 'user'
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                            }`}
                          >
                            <div className="text-sm">{message.content}</div>
                            <div className={`text-xs mt-1 ${
                              message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                            }`}>
                              {new Date(message.timestamp).toLocaleTimeString()}
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {isTyping && (
                        <div className="flex justify-start">
                          <div className="bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 px-4 py-2 rounded-lg">
                            <div className="flex items-center space-x-1">
                              <div className="animate-bounce">●</div>
                              <div className="animate-bounce" style={{ animationDelay: '0.1s' }}>●</div>
                              <div className="animate-bounce" style={{ animationDelay: '0.2s' }}>●</div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          value={inputMessage}
                          onChange={(e) => setInputMessage(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                          placeholder="Type your message..."
                          className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500"
                          disabled={isLoading}
                        />
                        <button
                          onClick={sendMessage}
                          disabled={isLoading || !inputMessage.trim()}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-gray-500 dark:text-gray-400 mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium mb-2">Start a New Conversation</h3>
                      <p className="text-gray-500 dark:text-gray-400 mb-4">
                        Click "New Conversation" to begin chatting with AI
                      </p>
                      <button
                        onClick={createNewConversation}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                      >
                        Start Chatting
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default ChatSystem 