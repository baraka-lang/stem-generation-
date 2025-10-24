/**
 * Test script for password reset link generation
 * This script helps test the improved Edge Function implementation
 */

// Test the Edge Function endpoint
async function testPasswordResetLink(email) {
  const supabaseUrl = 'https://wfloobttzjbfapzyclun.supabase.co';
  const functionUrl = `${supabaseUrl}/functions/v1/send-email`;
  
  console.log('Testing password reset link generation for:', email);
  console.log('Function URL:', functionUrl);
  
  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_ANON_KEY_HERE' // Replace with your actual anon key
      },
      body: JSON.stringify({
        test: true,
        email: email
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('Test Result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\n✅ Password reset link generated successfully!');
      console.log('URL Type:', result.urlAnalysis?.urlType);
      console.log('Frontend Compatibility:', result.frontendCompatibility);
      
      // Validate URL structure
      const url = result.testUrl;
      console.log('\nURL Structure Analysis:');
      console.log('- Contains #reset-password:', url.includes('#reset-password'));
      console.log('- Has tokens:', url.includes('token_hash') || url.includes('token=') || url.includes('access_token'));
      console.log('- Is fallback:', url.includes('fallback=true'));
      
      // Test URL parsing (simulate frontend behavior)
      console.log('\nFrontend URL Parsing Test:');
      const urlObj = new URL(url);
      const hash = urlObj.hash;
      const search = urlObj.search;
      
      console.log('Hash:', hash);
      console.log('Search:', search);
      
      // Extract tokens like the frontend does
      let hashParams = new URLSearchParams();
      if (hash && hash.includes('reset-password')) {
        const hashPart = hash.startsWith('#') ? hash.substring(1) : hash;
        let resetPart = '';
        if (hashPart.includes('#reset-password#')) {
          resetPart = hashPart.split('#reset-password#')[1];
        } else if (hashPart.includes('#reset-password?')) {
          resetPart = hashPart.split('#reset-password?')[1];
        } else if (hashPart.includes('#reset-password')) {
          resetPart = hashPart.split('#reset-password')[1];
        } else {
          resetPart = hashPart;
        }
        hashParams = new URLSearchParams(resetPart);
      }
      
      const searchParams = new URLSearchParams(search);
      
      const tokenHash = hashParams.get('token_hash') || searchParams.get('token_hash');
      const token = hashParams.get('token') || searchParams.get('token');
      const accessToken = hashParams.get('access_token') || searchParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');
      const isFallback = hashParams.get('fallback') === 'true' || searchParams.get('fallback') === 'true';
      
      console.log('Extracted Tokens:');
      console.log('- token_hash:', tokenHash ? tokenHash.substring(0, 20) + '...' : 'None');
      console.log('- token:', token ? token.substring(0, 20) + '...' : 'None');
      console.log('- access_token:', accessToken ? accessToken.substring(0, 20) + '...' : 'None');
      console.log('- refresh_token:', refreshToken ? refreshToken.substring(0, 20) + '...' : 'None');
      console.log('- isFallback:', isFallback);
      
      // Determine which flow the frontend would use
      let flowType = 'Unknown';
      if (tokenHash) {
        flowType = 'PKCE (token_hash)';
      } else if (token) {
        flowType = 'OTP (token)';
      } else if (accessToken && refreshToken) {
        flowType = 'Legacy (access_token + refresh_token)';
      } else if (isFallback) {
        flowType = 'Fallback (no tokens)';
      }
      
      console.log('\nFrontend Flow Type:', flowType);
      
      if (isFallback) {
        console.log('⚠️  This is a fallback URL - user will need to request a new reset');
      } else {
        console.log('✅ This URL should work with the frontend password reset page');
      }
      
    } else {
      console.log('❌ Password reset link generation failed:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Usage examples
console.log('Password Reset Link Generation Test');
console.log('===================================\n');

// Test with a sample email
testPasswordResetLink('test@example.com');

// You can also test with your actual email
// testPasswordResetLink('your-email@domain.com');
