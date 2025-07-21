-- AI Content Studio Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE,
    credits INTEGER DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Generations table
CREATE TABLE IF NOT EXISTS generations (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'image', 'audio', 'video')),
    prompt TEXT NOT NULL,
    content TEXT NOT NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generations_type ON generations(type);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_generations_updated_at BEFORE UPDATE ON generations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to decrement credits
CREATE OR REPLACE FUNCTION decrement_credits(user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    current_credits INTEGER;
BEGIN
    -- Get current credits
    SELECT credits INTO current_credits FROM users WHERE id = user_id;
    
    -- Decrement credits (minimum 0)
    RETURN GREATEST(current_credits - 1, 0);
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (RLS) policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users can view own data" ON users
    FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update own data" ON users
    FOR UPDATE USING (auth.uid()::text = id::text);

-- Users can view their own generations
CREATE POLICY "Users can view own generations" ON generations
    FOR SELECT USING (auth.uid()::text = user_id::text);

-- Users can insert their own generations
CREATE POLICY "Users can insert own generations" ON generations
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- Allow anonymous access for demo purposes (remove in production)
CREATE POLICY "Allow anonymous access to generations" ON generations
    FOR ALL USING (true);

CREATE POLICY "Allow anonymous access to users" ON users
    FOR ALL USING (true);

-- Insert some sample data for testing
INSERT INTO users (id, email, credits) VALUES 
    ('demo-user-1', 'demo1@example.com', 150),
    ('demo-user-2', 'demo2@example.com', 75)
ON CONFLICT (id) DO NOTHING;

-- Sample generations
INSERT INTO generations (user_id, type, prompt, content, settings) VALUES 
    ('demo-user-1', 'text', 'Write a professional email', 'Generated text content...', '{"tone": "professional"}'),
    ('demo-user-1', 'image', 'A beautiful sunset', 'data:image/svg+xml;base64,...', '{"style": "realistic"}'),
    ('demo-user-2', 'audio', 'Podcast intro', 'data:audio/wav;base64,...', '{"voice": "male"}')
ON CONFLICT DO NOTHING; 