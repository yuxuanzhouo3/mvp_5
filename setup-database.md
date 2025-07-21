# 🚀 Database Setup Guide

## ❌ **Current Status: Database NOT Set Up**

The API is working, but the database tables don't exist yet. Here's how to fix this:

## 📋 **Step-by-Step Setup**

### 1. **Go to Your Supabase Dashboard**
- Visit: https://supabase.com/dashboard
- Select your project: `xznbklxpjusvamjpflyh`

### 2. **Open SQL Editor**
- Click on **"SQL Editor"** in the left sidebar
- Click **"New Query"**

### 3. **Run the Basic Schema**
Copy and paste this **basic schema** first:

```sql
-- Basic Schema for AI Content Studio
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, -- Using TEXT for demo user IDs
    email TEXT UNIQUE,
    credits INTEGER DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Generations table
CREATE TABLE IF NOT EXISTS generations (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'image', 'audio', 'video')),
    prompt TEXT NOT NULL,
    content TEXT NOT NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at DESC);

-- Insert sample user
INSERT INTO users (id, email, credits) VALUES 
    ('demo-user-1', 'demo1@example.com', 150)
ON CONFLICT (id) DO NOTHING;
```

### 4. **Click "Run"**
- Click the **"Run"** button to execute the schema
- You should see a success message

### 5. **Test the Connection**
Run this command to test if the database is working:

```bash
curl -X GET "https://xznbklxpjusvamjpflyh.supabase.co/rest/v1/users?select=*" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmJrbHhwanVzdmFtanBmbHloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MTAxMDgsImV4cCI6MjA2ODA4NjEwOH0.YMqUcA-SBnLnoSIkqniKNHJDpsgPdFa60KlIfbjSoUI"
```

You should see the sample user data.

### 6. **Test the API**
Test the generation API:

```bash
curl -X POST "http://localhost:3002/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello world","type":"text","userId":"demo-user-1"}'
```

## ✅ **Expected Results**

After setup, you should see:
- ✅ Database tables created
- ✅ Sample user data
- ✅ API working with database
- ✅ Generations being saved
- ✅ Credits being deducted

## 🔧 **Troubleshooting**

### If you get "relation does not exist":
- Make sure you ran the SQL schema
- Check that you're in the correct Supabase project
- Verify the table names match

### If you get "User not found":
- Make sure the sample user was inserted
- Check the user ID format

### If API calls fail:
- Make sure the development server is running
- Check the Supabase URL and key are correct

## 🎯 **Quick Test Commands**

```bash
# Test database connection
curl -X GET "https://xznbklxpjusvamjpflyh.supabase.co/rest/v1/users?select=*" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmJrbHhwanVzdmFtanBmbHloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MTAxMDgsImV4cCI6MjA2ODA4NjEwOH0.YMqUcA-SBnLnoSIkqniKNHJDpsgPdFa60KlIfbjSoUI"

# Test generation API
curl -X POST "http://localhost:3002/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Test generation","type":"text","userId":"demo-user-1"}'

# Test credits API
curl -X GET "http://localhost:3002/api/user/credits?userId=demo-user-1"
```

## 🚀 **Next Steps**

Once the basic setup works:
1. Run the **enhanced schema** (`supabase-schema-enhanced.sql`) for full features
2. Test all the UI features
3. Customize based on your needs

---

**Let me know when you've run the schema and I'll help you test it!** 🎉 