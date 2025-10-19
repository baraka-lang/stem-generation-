// Deno Edge Function — Custom Email Templates for Supabase Auth
//
// This function intercepts Supabase auth events and sends custom email templates
// for user confirmation, password reset, and welcome emails. It replaces the
// default Supabase auth emails with branded templates that match the app design.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

// Email template configurations
const emailTemplates = {
  confirmation: {
    subject: 'Confirm Your Email - 343 Labs AI Music Studio',
    template: 'confirmation.html'
  },
  password_reset: {
    subject: 'Reset Your Password - 343 Labs AI Music Studio',
    template: 'password-reset.html'
  },
  welcome: {
    subject: 'Welcome to 343 Labs AI Music Studio!',
    template: 'welcome.html'
  }
};

// Template variable replacements
const templateVariables = {
  '{{USER_EMAIL}}': (data: any) => data.email || data.user?.email || '',
  '{{CONFIRMATION_LINK}}': (data: any) => data.confirmation_url || data.action_link || '',
  '{{RESET_LINK}}': (data: any) => data.reset_url || data.action_link || '',
  '{{APP_URL}}': () => Deno.env.get('APP_URL') || 'https://your-app.com',
  '{{SUPPORT_URL}}': () => Deno.env.get('SUPPORT_URL') || 'https://your-app.com/support',
  '{{PRIVACY_URL}}': () => Deno.env.get('PRIVACY_URL') || 'https://your-app.com/privacy',
  '{{TERMS_URL}}': () => Deno.env.get('TERMS_URL') || 'https://your-app.com/terms'
};

/**
 * Load email template from file system
 */
async function loadEmailTemplate(templateName: string): Promise<string> {
  try {
    const templatePath = `./EmailTemplates/${templateName}`;
    const templateContent = await Deno.readTextFile(templatePath);
    return templateContent;
  } catch (error) {
    console.error(`Failed to load template ${templateName}:`, error);
    // Fallback to inline templates if file loading fails
    return getInlineTemplate(templateName);
  }
}

/**
 * Get inline email template HTML content as fallback
 */
function getInlineTemplate(templateName: string): string {
  if (templateName === 'password-reset.html') {
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
        .security-notice { background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 24px 0; font-size: 14px; color: #92400e; }
        .warning-notice { background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 16px; margin: 24px 0; font-size: 14px; color: #dc2626; }
        @media (max-width: 600px) { .email-container { margin: 0; } .content { padding: 30px 20px; } .header { padding: 30px 20px; } .logo { font-size: 28px; } .title { font-size: 20px; } }
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
                <a href="{{RESET_LINK}}" class="reset-button">Reset Password</a>
            </div>
            <div class="warning-notice">
                <strong>Important:</strong> This password reset link will expire in 1 hour for security reasons.
            </div>
            <div class="security-notice">
                <strong>Security Notice:</strong> If you didn't request this password reset, please ignore this email.
            </div>
        </div>
        <div class="footer">
            <p class="footer-text">This email was sent to {{USER_EMAIL}} because a password reset was requested for your account.</p>
            <p class="footer-text">© 2024 343 Labs. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;
  }
  
  if (templateName === 'confirmation.html') {
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
        @media (max-width: 600px) { .email-container { margin: 0; } .content { padding: 30px 20px; } .header { padding: 30px 20px; } .logo { font-size: 28px; } .title { font-size: 20px; } }
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
                <a href="{{CONFIRMATION_LINK}}" class="confirm-button">Confirm Email</a>
            </div>
            <p class="message">If you did not create an account, please ignore this email.</p>
        </div>
        <div class="footer">
            <p class="footer-text">This email was sent to {{USER_EMAIL}} to confirm your account.</p>
            <p class="footer-text">© 2024 343 Labs. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;
  }
  
  if (templateName === 'welcome.html') {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to 343 Labs AI Music Studio</title>
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
        .welcome-button { display: inline-block; background: linear-gradient(135deg, #8b5cf6, #ec4899); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3); }
        .welcome-button:hover { transform: translateY(-2px); }
        .footer { background-color: #f1f5f9; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0; }
        .footer-text { font-size: 14px; color: #64748b; margin: 0 0 16px 0; }
        @media (max-width: 600px) { .email-container { margin: 0; } .content { padding: 30px 20px; } .header { padding: 30px 20px; } .logo { font-size: 28px; } .title { font-size: 20px; } }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1 class="logo">343 Labs AI Music Studio</h1>
            <p class="tagline">Create professional-quality stems with AI-powered music generation</p>
        </div>
        <div class="content">
            <h2 class="title">Welcome to 343 Labs!</h2>
            <p class="message">Your account has been successfully created and verified. Welcome to 343 Labs AI Music Studio!</p>
            <p class="message">We're excited to have you. Start creating professional-quality stems with our AI-powered music generation.</p>
            <div class="button-container">
                <a href="{{APP_URL}}" class="welcome-button">Go to Studio</a>
            </div>
            <p class="message">If you have any questions, feel free to contact our support team.</p>
        </div>
        <div class="footer">
            <p class="footer-text">This email was sent to {{USER_EMAIL}} to welcome you to 343 Labs.</p>
            <p class="footer-text">© 2024 343 Labs. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`;
  }
  
  // Default fallback
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #8b5cf6;">Email from 343 Labs AI Music Studio</h2>
      <p>Hello {{USER_EMAIL}},</p>
      <p>This is an email from 343 Labs AI Music Studio.</p>
      <p>Best regards,<br>343 Labs Team</p>
    </div>
  `;
}

/**
 * Replace template variables with actual values
 */
function replaceTemplateVariables(template: string, data: any): string {
  let processedTemplate = template;
  
  for (const [placeholder, valueFunction] of Object.entries(templateVariables)) {
    const value = valueFunction(data);
    processedTemplate = processedTemplate.replace(new RegExp(placeholder, 'g'), value);
  }
  
  return processedTemplate;
}

/**
 * Send email using Supabase's built-in email service
 */
async function sendEmail(to: string, subject: string, htmlContent: string): Promise<void> {
  try {
    console.log('sendEmail called with:', { to, subject, htmlLength: htmlContent.length });
    
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    console.log('Resend API key check:', resendApiKey ? 'Found' : 'Not found');
    
    if (!resendApiKey) {
      console.error('RESEND_API_KEY not found in environment variables');
      throw new Error('RESEND_API_KEY not configured in Edge Function environment variables');
    }
    
    console.log('Resend API key found, making request to Resend API...');

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
  } catch (error) {
    console.error('Failed to send email via Resend:', error);
    throw new Error('Email sending failed');
  }
}

/**
 * Handle user signup confirmation email
 */
async function handleConfirmationEmail(data: any): Promise<void> {
  const template = await loadEmailTemplate(emailTemplates.confirmation.template);
  const htmlContent = replaceTemplateVariables(template, data);
  
  await sendEmail(
    data.user?.email || data.email,
    emailTemplates.confirmation.subject,
    htmlContent
  );
}

/**
 * Handle password reset email
 */
async function handlePasswordResetEmail(data: any): Promise<void> {
  try {
    // Generate proper password reset URL with tokens
    const resetUrl = await generatePasswordResetUrl(data.user?.email || data.email, data.reset_url);
    
    // Update the data with the actual reset URL containing tokens
    const emailData = {
      ...data,
      reset_url: resetUrl
    };
    
  const template = await loadEmailTemplate(emailTemplates.password_reset.template);
    const htmlContent = replaceTemplateVariables(template, emailData);
  
  await sendEmail(
    data.user?.email || data.email,
    emailTemplates.password_reset.subject,
    htmlContent
  );
    
    console.log('Password reset email sent successfully to:', data.user?.email || data.email);
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    throw error;
  }
}

/**
 * Handle welcome email after confirmation
 */
async function handleWelcomeEmail(data: any): Promise<void> {
  const template = await loadEmailTemplate(emailTemplates.welcome.template);
  const htmlContent = replaceTemplateVariables(template, data);
  
  await sendEmail(
    data.user?.email || data.email,
    emailTemplates.welcome.subject,
    htmlContent
  );
}

/**
 * Handle password update request
 */
async function handlePasswordUpdate(email: string, newPassword: string, token: string): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    // Validate the token
    const tokenData = JSON.parse(atob(token));
    
    // Check if token is expired (1 hour)
    const tokenAge = Date.now() - tokenData.timestamp;
    const oneHour = 60 * 60 * 1000;
    
    if (tokenAge > oneHour) {
      throw new Error('Reset token has expired');
    }
    
    // Verify email matches
    if (tokenData.email !== email) {
      throw new Error('Invalid reset token');
    }
    
    // Verify token type
    if (tokenData.type !== 'password_reset') {
      throw new Error('Invalid reset token');
    }

    // Update the user's password using Supabase Admin API
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'GET',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch users');
    }

    const users = await response.json();
    const user = users.users.find((u: any) => u.email === email);

    if (!user) {
      throw new Error('User not found');
    }

    // Update the password
    const updateResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        password: newPassword
      })
    });

    if (!updateResponse.ok) {
      throw new Error('Failed to update password');
    }

    console.log('Password updated successfully for user:', email);
  } catch (error) {
    console.error('Error updating password:', error);
    throw error;
  }
}

/**
 * Generate password reset URL with Supabase tokens
 */
async function generatePasswordResetUrl(email: string, baseUrl: string): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    // Create a custom token with email and timestamp
    const tokenData = {
        email: email,
      timestamp: Date.now(),
      type: 'password_reset'
    };

    // Encode the token data
    const token = btoa(JSON.stringify(tokenData));
    
    // Create the reset URL with our custom token
    const resetUrl = `${baseUrl}?token=${token}&email=${encodeURIComponent(email)}`;
    
    console.log('Generated custom reset URL:', resetUrl);
    return resetUrl;
  } catch (error) {
    console.error('Error generating password reset URL:', error);
    // Fallback to the base URL if token generation fails
    console.log('Falling back to base URL:', baseUrl);
    return baseUrl;
  }
}

/**
 * Main handler for the Edge Function
 */
Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Temporarily disable authentication for testing
    console.log('Request received, processing...');
    
    const body = await req.json();
    
    // Check if this is a direct email request (not a webhook)
    if (body.emailType && body.email) {
      console.log('Direct email request:', { emailType: body.emailType, email: body.email, data: body.data });
      
      // Handle direct email sending
      let templateName: string;
      let subject: string;
      let emailData: any = { email: body.email, ...body.data };

      switch (body.emailType) {
        case 'confirmation':
          templateName = emailTemplates.confirmation.template;
          subject = emailTemplates.confirmation.subject;
          break;
        case 'password_reset':
          templateName = emailTemplates.password_reset.template;
          subject = emailTemplates.password_reset.subject;
          
          // Generate proper password reset URL with tokens
          if (body.data?.reset_url) {
            try {
              const resetUrl = await generatePasswordResetUrl(body.email, body.data.reset_url);
              // Update the email data with the actual reset URL containing tokens
              emailData.reset_url = resetUrl;
              console.log('Generated reset URL:', resetUrl);
            } catch (error) {
              console.error('Failed to generate reset URL, using provided URL:', error);
              // Fall back to the provided URL
            }
          }
          break;
        case 'password_update':
          // Handle password update request
          await handlePasswordUpdate(body.email, body.data.newPassword, body.data.token);
          return new Response(
            JSON.stringify({ success: true, message: 'Password updated successfully' }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200 
            }
          );
        case 'welcome':
          templateName = emailTemplates.welcome.template;
          subject = emailTemplates.welcome.subject;
          break;
        default:
          throw new Error('Invalid email type');
      }

      console.log('Loading template:', templateName);
      const template = await loadEmailTemplate(templateName);
      console.log('Template loaded, length:', template.length);
      
      const htmlContent = replaceTemplateVariables(template, emailData);
      console.log('Template processed, HTML length:', htmlContent.length);
      console.log('Sending email to:', body.email, 'Subject:', subject);
      
      try {
        await sendEmail(body.email, subject, htmlContent);
        console.log('Email sent successfully to:', body.email);

        return new Response(
          JSON.stringify({ success: true, message: 'Email sent successfully' }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        );
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
        throw new Error(`Failed to send email: ${emailError.message}`);
      }
    }

    // Handle webhook events (original functionality)
    const { type, record, old_record } = body;
    
    console.log('Received webhook:', { type, recordId: record?.id });

    // Handle different auth events
    switch (type) {
      case 'INSERT':
        // User signed up - send confirmation email only if this is a truly new user
        // Check if user was created recently (within last 5 minutes) to avoid duplicates
        const userCreatedAt = new Date(record?.created_at);
        const now = new Date();
        const timeDiff = now.getTime() - userCreatedAt.getTime();
        const isRecentUser = timeDiff < 5 * 60 * 1000; // 5 minutes in milliseconds
        
        // Additional check: verify this is truly a new user by checking if they have a profile
        // If they already have a profile, they're not new
        let isNewUser = isRecentUser;
        if (isRecentUser) {
          try {
            // Check if user already has a profile (indicating they're not new)
            const supabaseUrl = Deno.env.get('SUPABASE_URL');
            const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
            
            if (supabaseUrl && supabaseServiceKey) {
              const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${record.id}&select=id`, {
                headers: {
                  'apikey': supabaseServiceKey,
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                  'Content-Type': 'application/json'
                }
              });
              
              if (response.ok) {
                const profiles = await response.json();
                isNewUser = profiles.length === 0; // No profile means truly new user
              }
            }
          } catch (error) {
            console.error('Error checking user profile:', error);
            // If we can't check, assume it's new if recent
          }
        }
        
        if (record?.email_confirmed_at === null) {
          if (isNewUser) {
            console.log('Sending confirmation email for new user:', record.email);
          } else {
            console.log('Sending confirmation email for existing unconfirmed user:', record.email);
          }
          
          await handleConfirmationEmail({
            user: record,
            email: record.email,
            confirmation_url: `${Deno.env.get('APP_URL')}/reset-password.html#access_token={{TOKEN}}&refresh_token={{REFRESH_TOKEN}}&type=recovery`
          });
        } else if (record?.email_confirmed_at !== null) {
          console.log('Skipping email for already confirmed user:', record.email, 'Created:', userCreatedAt);
        }
        break;

      case 'UPDATE':
        // User confirmed email - send welcome email only if email was just confirmed
        if (old_record?.email_confirmed_at === null && record?.email_confirmed_at !== null) {
          console.log('Sending welcome email for confirmed user:', record.email);
          await handleWelcomeEmail({
            user: record,
            email: record.email
          });
        }
        break;

      case 'PASSWORD_RECOVERY':
        // Password reset request - send custom password reset email
        console.log('Sending password reset email for user:', record.email);
        await handlePasswordResetEmail({
          user: record,
          email: record.email,
          reset_url: `${Deno.env.get('APP_URL')}/reset-password.html`
        });
        break;

      default:
        console.log('Unhandled event type:', type);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email processed successfully' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Edge function error:', error);
    console.error('Error stack:', error.stack);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Internal server error',
        details: error.toString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

/**
 * Password Reset Email Handler
 * This function is called when a user requests a password reset
 */
export async function handlePasswordResetRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, resetUrl } = await req.json();
    
    if (!email || !resetUrl) {
      throw new Error('Email and reset URL are required');
    }

    await handlePasswordResetEmail({
      email,
      reset_url: resetUrl
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Password reset email sent successfully' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Password reset email error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to send password reset email' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
}

/**
 * Alternative endpoint for manual email sending (for testing)
 */
export async function sendCustomEmail(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { emailType, email, data } = await req.json();
    
    if (!emailType || !email) {
      throw new Error('emailType and email are required');
    }

    let templateName: string;
    let subject: string;

    switch (emailType) {
      case 'confirmation':
        templateName = emailTemplates.confirmation.template;
        subject = emailTemplates.confirmation.subject;
        break;
      case 'password_reset':
        templateName = emailTemplates.password_reset.template;
        subject = emailTemplates.password_reset.subject;
        break;
      case 'welcome':
        templateName = emailTemplates.welcome.template;
        subject = emailTemplates.welcome.subject;
        break;
      default:
        throw new Error('Invalid email type');
    }

    const template = await loadEmailTemplate(templateName);
    const htmlContent = replaceTemplateVariables(template, { email, ...data });
    
    await sendEmail(email, subject, htmlContent);

    return new Response(
      JSON.stringify({ success: true, message: 'Email sent successfully' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Custom email error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to send email' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
}
