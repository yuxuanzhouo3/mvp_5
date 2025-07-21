# 🚀 Quick Database Setup

## ❌ **Current Problem**
The database tables don't exist, so the API returns 404 errors.

## ✅ **Solution: 3 Simple Steps**

### **Step 1: Go to Supabase Dashboard**
1. Visit: https://supabase.com/dashboard
2. Click on your project: `xznbklxpjusvamjpflyh`

### **Step 2: Run the Database Setup**
1. Click **"SQL Editor"** in the left sidebar
2. Click **"New Query"**
3. Copy the entire contents of `database-setup.sql`
4. Paste it into the SQL editor
5. Click **"Run"**

### **Step 3: Test It Works**
After running the SQL, test with these commands:

```bash
# Test database connection
curl -X GET "https://xznbklxpjusvamjpflyh.supabase.co/rest/v1/users?select=*" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmJrbHhwanVzdmFtanBmbHloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MTAxMDgsImV4cCI6MjA2ODA4NjEwOH0.YMqUcA-SBnLnoSIkqniKNHJDpsgPdFa60KlIfbjSoUI"

# Test generation API
curl -X POST "http://localhost:3002/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello world","type":"text","userId":"demo-user-1"}'
```

## 🎯 **Expected Results**

After setup, you should see:
- ✅ JSON response with user data (not error)
- ✅ Generation API working
- ✅ Credits being deducted
- ✅ Content being saved

## 🔧 **If It Still Doesn't Work**

1. **Check Supabase Project**: Make sure you're in the right project
2. **Check SQL Execution**: Look for success message in SQL editor
3. **Check Table Editor**: Go to "Table Editor" and see if tables exist
4. **Check API Key**: Verify the API key is correct

## 📋 **What the Setup Creates**

- **`users` table**: Store user data and credits
- **`generations` table**: Store all generated content
- **Sample data**: 2 demo users with sample generations
- **Indexes**: For fast queries
- **Security policies**: Allow demo access

---

**Run the SQL and let me know if you see the success message!** 🎉 