# Supabase Integration Setup Guide

## 🚀 Quick Setup

### 1. Database Setup

1. **Go to your Supabase Dashboard**
   - Navigate to [https://supabase.com/dashboard](https://supabase.com/dashboard)
   - Select your project: `xznbklxpjusvamjpflyh`

2. **Run the Database Schema**
   - Go to **SQL Editor** in your Supabase dashboard
   - Copy and paste the contents of `supabase-schema.sql`
   - Click **Run** to execute the schema

3. **Verify Tables Created**
   - Go to **Table Editor**
   - You should see `users` and `generations` tables
   - Check that the sample data was inserted

### 2. Environment Variables

The Supabase credentials are already configured in `lib/supabase.ts`:

```typescript
const supabaseUrl = 'https://xznbklxpjusvamjpflyh.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

### 3. Test the Integration

1. **Start the development server**
   ```bash
   npm run dev
   ```

2. **Test User Authentication**
   - Click "Login (Demo)" in the top-left corner
   - This creates a demo user session

3. **Test Content Generation**
   - Generate some content (text, image, audio, video)
   - Check that it's saved to the database
   - Verify credits are deducted

4. **Test Credit System**
   - Click "Buy More" to add credits
   - Generate content until credits run out
   - Verify the "Insufficient credits" message

## 📊 Database Schema Overview

### Users Table
```sql
users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE,
    credits INTEGER DEFAULT 100,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
)
```

### Generations Table
```sql
generations (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    type TEXT CHECK (type IN ('text', 'image', 'audio', 'video')),
    prompt TEXT NOT NULL,
    content TEXT NOT NULL,
    settings JSONB,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
)
```

## 🔧 API Endpoints

### Generate Content
```http
POST /api/generate
Content-Type: application/json

{
  "prompt": "Your prompt here",
  "type": "text|image|audio|video",
  "settings": {...},
  "userId": "user-id"
}
```

### Get User Credits
```http
GET /api/user/credits?userId=user-id
```

### Update User Credits
```http
POST /api/user/credits
Content-Type: application/json

{
  "userId": "user-id",
  "credits": 150
}
```

### Get Generation History
```http
GET /api/generations?userId=user-id&limit=10
```

## 🛡️ Security Features

### Row Level Security (RLS)
- Users can only access their own data
- Anonymous access allowed for demo purposes
- Proper authentication checks in API routes

### Credit Management
- Credits are deducted per generation
- Minimum credit balance enforced
- Credit purchase functionality

### Data Validation
- Input validation on all API endpoints
- Type checking for content types
- Error handling with user-friendly messages

## 🔍 Monitoring & Debugging

### Check Database Logs
1. Go to **Logs** in Supabase dashboard
2. Monitor API requests and database queries
3. Check for any errors or performance issues

### Test Database Queries
```sql
-- Check user credits
SELECT * FROM users WHERE id = 'your-user-id';

-- Check generation history
SELECT * FROM generations WHERE user_id = 'your-user-id' ORDER BY created_at DESC;

-- Check credit usage
SELECT COUNT(*) as generations_count FROM generations WHERE user_id = 'your-user-id';
```

## 🚀 Production Considerations

### 1. Authentication
- Replace demo authentication with real auth (Supabase Auth)
- Implement proper user registration/login
- Add email verification

### 2. Security
- Remove anonymous access policies
- Implement proper API rate limiting
- Add request validation middleware

### 3. Performance
- Add database connection pooling
- Implement caching for frequently accessed data
- Optimize database queries

### 4. Monitoring
- Set up error tracking (Sentry)
- Add analytics for usage patterns
- Monitor credit usage and generation costs

## 🐛 Troubleshooting

### Common Issues

1. **"User not found" error**
   - Check if user exists in database
   - Verify user ID format (UUID)

2. **"Insufficient credits" error**
   - Check user's credit balance
   - Verify credit deduction logic

3. **Database connection errors**
   - Verify Supabase URL and key
   - Check network connectivity
   - Verify database is online

4. **RLS policy errors**
   - Check if policies are enabled
   - Verify user authentication
   - Test with anonymous access

### Debug Commands

```bash
# Check Supabase connection
curl -X GET "https://xznbklxpjusvamjpflyh.supabase.co/rest/v1/users?select=*" \
  -H "apikey: YOUR_ANON_KEY"

# Test API endpoints
curl -X POST "http://localhost:3002/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test","type":"text","userId":"test-user"}'
```

## 📈 Next Steps

1. **Real AI Integration**
   - Replace mock generation with real AI APIs
   - Implement proper error handling for AI services
   - Add generation cost tracking

2. **Advanced Features**
   - User profiles and preferences
   - Generation templates
   - Batch processing
   - Export functionality

3. **Analytics**
   - Usage analytics dashboard
   - Credit consumption reports
   - Popular generation types

4. **Collaboration**
   - Team workspaces
   - Shared generation libraries
   - Comment and feedback system

---

**Your Supabase integration is now ready! 🎉** 