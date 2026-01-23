# CORS Fix for Email Service Edge Function

## 🚨 **Issue**
The email service Edge Function is blocking requests from the frontend due to missing CORS headers.

## 🔧 **Solution**
Your lead developer needs to add these CORS headers to the Edge Function:

### **Add to the Edge Function (supabase/functions/send-email/index.ts):**

```typescript
// Add this at the top of the file, after the imports
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

// Update the main handler to include CORS support
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }
    
    // Health check route
    if (req.method === 'GET' && url.pathname.endsWith('/send-email/health')) {
      return new Response(JSON.stringify({
        status: 'ok'
      }), {
        headers: {
          'content-type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          'content-type': 'application/json',
          ...corsHeaders
        }
      });
    }
    
    // ... rest of your existing code ...
    
    // Make sure to include CORS headers in ALL responses
    const result = await sendWithResend(validated.data, apiKey);
    return new Response(JSON.stringify({
      success: true,
      result
    }), {
      headers: {
        'content-type': 'application/json',
        ...corsHeaders  // Add this to all responses
      }
    });
    
  } catch (err) {
    console.error('send-email error', err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Unknown error'
    }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders  // Add this to error responses too
      }
    });
  }
});
```

### **Complete CORS Headers to Add:**

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
```

## 🧪 **Test the Fix**

After your lead developer adds the CORS headers:

1. **Redeploy the Edge Function:**
   ```bash
   supabase functions deploy send-email
   ```

2. **Test from the frontend:**
   - Open `test-email-integration.html`
   - Click "Test Connection"
   - Should show "✅ Connection successful!"

## 📋 **What the Lead Developer Needs to Do:**

1. **Add CORS headers** to the Edge Function
2. **Handle OPTIONS requests** for preflight
3. **Include CORS headers** in all responses
4. **Redeploy the function**

## 🔍 **Current Error:**
```
Access to fetch at 'https://fsdknzsgdzlexyjallmy.supabase.co/functions/v1/send-email' 
from origin 'http://localhost:5173' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

## ✅ **After Fix:**
The email service should work properly with the frontend without CORS errors.

---

**Send this to your lead developer** - they need to add CORS support to the Edge Function!
