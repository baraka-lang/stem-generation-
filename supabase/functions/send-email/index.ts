// Deno Edge Function — Custom Email Templates for Supabase Auth
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, webhook-id, webhook-timestamp, webhook-signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

/**
 * Send email using Resend API
 */
async function sendEmail(to: string, subject: string, htmlContent: string): Promise<void> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not found, logging email details instead');
    console.log('=== EMAIL WOULD BE SENT ===');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('HTML Length:', htmlContent.length);
    console.log('=== END EMAIL PREVIEW ===');
    return;
  }
  
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendApiKey}`
    },
    body: JSON.stringify({
      from: '343 Labs <noreply@stemflow.app>',
      to: [to],
      subject: subject,
      html: htmlContent
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Resend API error: ${response.status} - ${errorData.message || response.statusText}`);
  }

  const result = await response.json();
  console.log('Email sent successfully via Resend:', result);
}

/**
 * Generate email confirmation URL with Supabase tokens
 */
async function generateConfirmationUrl(email: string): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL') || 'https://staging.stemflow.app';
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase configuration missing');
  }
  
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'signup',
    email: email,
    options: {
      redirectTo: `${appUrl}/#confirm-email`
    }
  });

  if (error) {
    console.error('generateLink error for confirmation:', error);
    const fallbackUrl = `${appUrl}/#confirm-email?email=${encodeURIComponent(email)}&type=signup&fallback=true`;
    return fallbackUrl;
  }
  
  let confirmationUrl = '';
  
  if (data.properties && data.properties.action_link) {
    confirmationUrl = data.properties.action_link;
  } else if (data.action_link) {
    confirmationUrl = data.action_link;
  } else if (data.hashed_token) {
    confirmationUrl = `${appUrl}/#confirm-email?token=${data.hashed_token}&type=signup`;
  } else {
    confirmationUrl = `${appUrl}/#confirm-email?email=${encodeURIComponent(email)}&type=signup&fallback=true`;
  }
  
  return confirmationUrl;
}

/**
 * Generate password reset URL with Supabase tokens
 */
async function generatePasswordResetUrl(email: string): Promise<string> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const appUrl = Deno.env.get('APP_URL') || 'https://staging.stemflow.app';
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
        email: email,
        options: {
      redirectTo: `${appUrl}/#reset-password`
    }
  });

  if (error) {
    console.error('generateLink error:', error);
    const fallbackUrl = `${appUrl}/#reset-password?email=${encodeURIComponent(email)}&type=recovery&fallback=true`;
    return fallbackUrl;
  }
  
  let resetUrl = '';
  
  if (data.properties && data.properties.action_link) {
    resetUrl = data.properties.action_link;
  } else if (data.action_link) {
    resetUrl = data.action_link;
  } else if (data.properties && data.properties.hashed_token) {
    resetUrl = `${appUrl}/#reset-password?token_hash=${data.properties.hashed_token}&type=recovery`;
  } else {
    throw new Error('Unexpected response structure from generateLink');
  }
  
  return resetUrl;
}

/**
 * Get inline email template HTML content
 */
function getEmailTemplate(templateType: string, confirmationUrl: string): string {
  if (templateType === 'confirmation') {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirm Your Email - 343 Labs AI Music Studio</title>
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; }
        .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #8b5cf6, #ec4899); padding: 40px 20px; text-align: center; }
        .logo { color: #ffffff; font-size: 32px; font-weight: bold; margin: 0 0 8px 0; }
        .tagline { color: rgba(255, 255, 255, 0.9); font-size: 16px; margin: 0; }
        .content { padding: 40px 30px; }
        .title { font-size: 24px; font-weight: bold; color: #1e293b; margin: 0 0 16px 0; text-align: center; }
        .message { font-size: 16px; line-height: 1.6; color: #64748b; margin: 0 0 32px 0; text-align: center; }
        .button-container { text-align: center; margin: 32px 0; }
        .confirm-button { display: inline-block; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3); }
        .confirm-button:hover { transform: translateY(-2px); }
        .footer { background-color: #f1f5f9; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0; }
        .footer-text { font-size: 14px; color: #64748b; margin: 0 0 16px 0; }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1 class="logo">343 Labs AI Music Studio</h1>
            <p class="tagline">Create professional-quality stems with AI-powered music generation</p>
        </div>
        <div class="content">
            <h2 class="title">Confirm Your Email</h2>
            <p class="message">Thank you for registering with 343 Labs AI Music Studio! To activate your account, please confirm your email address by clicking the button below.</p>
            <div class="button-container">
                <a href="${confirmationUrl}" class="confirm-button">Confirm Email</a>
            </div>
            <p class="message">If you did not create an account, please ignore this email.</p>
        </div>
        <div class="footer">
            <p class="footer-text">This email was sent to confirm your account.</p>
            <p class="footer-text">© 2024 343 Labs. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;
  }
  
  if (templateType === 'password_reset') {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password - 343 Labs AI Music Studio</title>
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; }
        .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #8b5cf6, #ec4899); padding: 40px 20px; text-align: center; }
        .logo { color: #ffffff; font-size: 32px; font-weight: bold; margin: 0 0 8px 0; }
        .tagline { color: rgba(255, 255, 255, 0.9); font-size: 16px; margin: 0; }
        .content { padding: 40px 30px; }
        .title { font-size: 24px; font-weight: bold; color: #1e293b; margin: 0 0 16px 0; text-align: center; }
        .message { font-size: 16px; line-height: 1.6; color: #64748b; margin: 0 0 32px 0; text-align: center; }
        .button-container { text-align: center; margin: 32px 0; }
        .reset-button { display: inline-block; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3); }
        .reset-button:hover { transform: translateY(-2px); }
        .footer { background-color: #f1f5f9; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0; }
        .footer-text { font-size: 14px; color: #64748b; margin: 0 0 16px 0; }
        .warning-notice { background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; margin: 24px 0; font-size: 14px; color: #dc2626; }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1 class="logo">343 Labs AI Music Studio</h1>
            <p class="tagline">Create professional-quality stems with AI-powered music generation</p>
        </div>
        <div class="content">
            <h2 class="title">Reset Your Password</h2>
            <p class="message">We received a request to reset your password for your 343 Labs AI Music Studio account. Click the button below to create a new password.</p>
            <div class="button-container">
                <a href="${confirmationUrl}" class="reset-button">Reset Password</a>
            </div>
            <div class="warning-notice">
                <strong>Important:</strong> This password reset link will expire in 1 hour for security reasons.
            </div>
        </div>
        <div class="footer">
            <p class="footer-text">This email was sent because a password reset was requested for your account.</p>
            <p class="footer-text">© 2024 343 Labs. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;
  }
  
  return '<p>Email template not found</p>';
}

/**
 * Main handler for the Edge Function
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Request received, processing...');
    
    // Check if this is a webhook request (from Auth Hook)
    const webhookId = req.headers.get('webhook-id');
    const webhookTimestamp = req.headers.get('webhook-timestamp');
    const webhookSignature = req.headers.get('webhook-signature');
    
    if (webhookId && webhookTimestamp && webhookSignature) {
      console.log('Processing webhook request from Auth Hook');
      
      const payload = await req.text();
      const hookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET');
      
      if (!hookSecret) {
        throw new Error('SEND_EMAIL_HOOK_SECRET not configured');
      }
      
      const headers = Object.fromEntries(req.headers);
      const wh = new Webhook(hookSecret.replace('v1,whsec_', ''));
      
      try {
        const { user, email_data } = wh.verify(payload, headers) as {
          user: {
            email: string;
            id: string;
          };
          email_data: {
            token: string;
            token_hash: string;
            redirect_to: string;
            email_action_type: string;
            site_url: string;
            token_new: string;
            token_hash_new: string;
          };
        };
        
        console.log('Webhook verified, processing email:', {
          email: user.email,
          action_type: email_data.email_action_type
        });
        
        let subject: string;
        let confirmationUrl: string;

        if (email_data.email_action_type === 'signup') {
          subject = 'Confirm Your Email - 343 Labs AI Music Studio';
          confirmationUrl = await generateConfirmationUrl(user.email);
        } else if (email_data.email_action_type === 'recovery') {
          subject = 'Reset Your Password - 343 Labs AI Music Studio';
          confirmationUrl = await generatePasswordResetUrl(user.email);
        } else {
          console.log('Unhandled email action type:', email_data.email_action_type);
          return new Response(JSON.stringify({ success: true, message: 'Email action type not handled' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
          });
        }

        const htmlContent = getEmailTemplate(email_data.email_action_type === 'signup' ? 'confirmation' : 'password_reset', confirmationUrl);
        
        await sendEmail(user.email, subject, htmlContent);
        console.log('Email sent successfully to:', user.email);

        return new Response(JSON.stringify({ success: true, message: 'Email sent successfully' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        });
        
      } catch (webhookError) {
        console.error('Webhook verification failed:', webhookError);
        return new Response(JSON.stringify({ 
          error: 'Webhook verification failed',
          details: webhookError.message 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401
        });
      }
    }
    
    // Handle other requests (direct calls, webhooks, etc.)
    const body = await req.json();
    
    return new Response(JSON.stringify({ success: true, message: 'Request processed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
    });

  } catch (error) {
    console.error('Edge function error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Internal server error' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});