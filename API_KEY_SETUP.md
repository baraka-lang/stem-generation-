# API Key Setup for Email Service

## 🔐 **Current Issue**
The email service is returning "Invalid JWT" because we need the correct API key for Supabase Edge Functions.

## 🔑 **Get the Correct API Key**

### **Option 1: Use Supabase Anon Key (Recommended)**
Your `VITE_SUPABASE_ANON_KEY` should work for Edge Functions. Make sure it's set in your `.env` file:

```env
VITE_EMAIL_SERVICE_URL=https://fsdknzsgdzlexyjallmy.supabase.co/functions/v1/send-email
VITE_EMAIL_SERVICE_KEY=your_supabase_anon_key_here
```

### **Option 2: Use Service Role Key (If Anon Key Doesn't Work)**
If the anon key doesn't work, you might need the service role key:

1. **Go to your Supabase Dashboard**
2. **Navigate to Settings → API**
3. **Copy the `service_role` key** (not the anon key)
4. **Use that as your `VITE_EMAIL_SERVICE_KEY`**

## 🧪 **Test the API Key**

### **Method 1: Test with Browser Console**
Open your browser console and run:

```javascript
// Test the API key
fetch('https://fsdknzsgdzlexyjallmy.supabase.co/functions/v1/send-email', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': 'YOUR_API_KEY_HERE'
  },
  body: JSON.stringify({
    to: 'test@example.com',
    subject: 'Test Email',
    html: '<h1>Test</h1>'
  })
})
.then(response => response.json())
.then(data => console.log('Success:', data))
.catch(error => console.error('Error:', error))
```

### **Method 2: Use the Test Page**
1. **Open `test-email-integration.html`**
2. **Set your API key** in the environment variables
3. **Click "Test Connection"**
4. **Should show success or specific error message**

## 🔧 **Common API Key Issues**

### **Issue 1: Wrong Key Type**
- **Problem**: Using wrong type of key
- **Solution**: Try both anon key and service role key

### **Issue 2: Key Not Set**
- **Problem**: `VITE_EMAIL_SERVICE_KEY` not set in `.env`
- **Solution**: Add the key to your `.env` file

### **Issue 3: Key Expired**
- **Problem**: API key has expired
- **Solution**: Generate a new key from Supabase dashboard

## 📋 **Quick Fix Steps**

1. **Check your `.env` file** has:
   ```env
   VITE_EMAIL_SERVICE_URL=https://fsdknzsgdzlexyjallmy.supabase.co/functions/v1/send-email
   VITE_EMAIL_SERVICE_KEY=your_actual_api_key
   ```

2. **Restart your development server** after updating `.env`

3. **Test the connection** with the test page

4. **If still failing**, try the service role key instead of anon key

## 🚀 **Expected Success Response**

When the API key is correct, you should see:
```json
{
  "success": true,
  "result": {
    "id": "email-id-here"
  }
}
```

## ❌ **Common Error Responses**

- **401 Unauthorized**: Wrong API key
- **400 Bad Request**: Missing required fields
- **500 Internal Server Error**: Server-side issue

---

**Next Step**: Update your `VITE_EMAIL_SERVICE_KEY` with the correct API key and test again!
