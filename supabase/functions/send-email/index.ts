// Deno Edge Function — Custom Email Templates for Supabase Auth
//
// This function intercepts Supabase auth events and sends custom email templates
// for user confirmation, password reset, and welcome emails. It replaces the
// default Supabase auth emails with branded templates that match the app design.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    throw new Error(`Template ${templateName} not found`);
  }
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
    // In a real implementation, you would use Supabase's email service
    // or integrate with a service like SendGrid, Resend, or AWS SES
    
    // For now, we'll log the email details
    console.log('Email would be sent:', {
      to,
      subject,
      htmlLength: htmlContent.length
    });
    
    // TODO: Implement actual email sending
    // Example with Supabase's email service:
    // const { error } = await supabase.functions.invoke('send-email', {
    //   body: { to, subject, html: htmlContent }
    // });
    
  } catch (error) {
    console.error('Failed to send email:', error);
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
  const template = await loadEmailTemplate(emailTemplates.password_reset.template);
  const htmlContent = replaceTemplateVariables(template, data);
  
  await sendEmail(
    data.user?.email || data.email,
    emailTemplates.password_reset.subject,
    htmlContent
  );
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
 * Generate password reset URL with Supabase tokens
 */
async function generatePasswordResetUrl(email: string, baseUrl: string): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    // Use Supabase Admin API to generate password reset token
    const response = await fetch(`${supabaseUrl}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        options: {
          redirectTo: baseUrl
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to generate reset token: ${error}`);
    }

    // Supabase will send the email with the proper reset URL
    // We return the base URL for the template
    return baseUrl;
  } catch (error) {
    console.error('Error generating password reset URL:', error);
    throw error;
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
    const body = await req.json();
    
    // Check if this is a direct email request (not a webhook)
    if (body.emailType && body.email) {
      console.log('Direct email request:', { emailType: body.emailType, email: body.email });
      
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
              await generatePasswordResetUrl(body.email, body.data.reset_url);
              // The actual reset URL will be sent by Supabase
              // We use the provided URL as a fallback in the template
            } catch (error) {
              console.error('Failed to generate reset URL, using provided URL:', error);
              // Fall back to the provided URL
            }
          }
          break;
        case 'welcome':
          templateName = emailTemplates.welcome.template;
          subject = emailTemplates.welcome.subject;
          break;
        default:
          throw new Error('Invalid email type');
      }

      const template = await loadEmailTemplate(templateName);
      const htmlContent = replaceTemplateVariables(template, emailData);
      
      await sendEmail(body.email, subject, htmlContent);

      return new Response(
        JSON.stringify({ success: true, message: 'Email sent successfully' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
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
