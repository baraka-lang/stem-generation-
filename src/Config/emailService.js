/**
 * Email Service
 * Handles calling the custom email sending Edge Function.
 */

import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client for Edge Function calls
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Email service configuration
const EMAIL_SERVICE_CONFIG = {
   // The URL of your Deno Edge Function, set in your environment variables
   endpoint: import.meta.env.VITE_EMAIL_SERVICE_URL || '',
   // Optional API key if you were to add authentication to your edge function
   apiKey: import.meta.env.VITE_EMAIL_SERVICE_KEY || '',
   
   // A flag to determine if the custom service is configured
   useCustomService: !!import.meta.env.VITE_EMAIL_SERVICE_URL,
   
   // Email template types that correspond to the types in the Edge Function
   templates: {
     CONFIRMATION: 'confirmation',
     PASSWORD_RESET: 'password_reset', 
     WELCOME: 'welcome',
     EMAIL_CHANGE: 'email_change'
   }
 };
  
  /**
   * Sends an email by calling the custom Edge Function.
   * @param {string} templateType - The type of email to send (e.g., 'confirmation').
   * @param {string} email - The recipient's email address.
   * @param {Object} [data={}] - An object containing template-specific data, like a confirmation_url or reset_url.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  export async function sendCustomEmail(templateType, email, emailData = {}) {
   // Check if the email service is configured; if not, return an error.
   if (!EMAIL_SERVICE_CONFIG.useCustomService) {
     console.warn('Custom email service is not configured. Set VITE_EMAIL_SERVICE_URL to use it.');
     return { success: false, error: 'Email service not configured' };
   }

   try {
     // This is the payload that the Deno Edge Function expects.
     const requestBody = {
       emailType: templateType,
       email: email,
       data: emailData
     };

     console.log('Calling email service with payload:', requestBody);

    // Use Supabase client to call the Edge Function
    const { data: responseData, error } = await supabase.functions.invoke('send-email', {
      body: requestBody
    });

    if (error) {
      throw new Error(error.message || 'Failed to call Edge Function');
    }

    const response = { ok: true, json: () => Promise.resolve(responseData) };
  
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
  
      const result = await response.json();
      console.log('Email service responded successfully:', result);
      
      return { success: true, data: result };
  
    } catch (error) {
      console.error('Failed to send email via custom service:', error);
      
      return { 
        success: false, 
        error: error.message || 'An unknown error occurred while sending the email.' 
      };
    }
  }
  
  /**
   * Send password reset email.
   * @param {string} email - User's email address.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  export async function sendPasswordResetEmail(email) {
    return await sendCustomEmail(EMAIL_SERVICE_CONFIG.templates.PASSWORD_RESET, email, {});
  }
  
  /**
   * Send email confirmation email.
   * @param {string} email - User's email address.
   * @param {string} confirmationUrl - Email confirmation URL.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  export async function sendConfirmationEmail(email, confirmationUrl) {
    return await sendCustomEmail(EMAIL_SERVICE_CONFIG.templates.CONFIRMATION, email, {
      confirmation_url: confirmationUrl // This key must match the placeholder
    });
  }
  
  /**
   * Send welcome email.
   * @param {string} email - User's email address.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  export async function sendWelcomeEmail(email) {
    return await sendCustomEmail(EMAIL_SERVICE_CONFIG.templates.WELCOME, email);
  }
  
  /**
   * Send email change confirmation.
   * @param {string} email - User's new email address.
   * @param {string} confirmationUrl - Email change confirmation URL.
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  export async function sendEmailChangeConfirmation(email, confirmationUrl) {
    return await sendCustomEmail(EMAIL_SERVICE_CONFIG.templates.EMAIL_CHANGE, email, {
      confirmation_url: confirmationUrl // This key must match the placeholder
    });
  }
  
  /**
   * Test the email service connection by sending a POST request.
   * @returns {Promise<{success: boolean, error?: string, message?: string}>}
   */
  export async function testEmailService() {
    if (!EMAIL_SERVICE_CONFIG.endpoint) {
      return { success: false, error: 'Email service endpoint not configured.' };
    }
  
    try {
      // A more robust test is to send a valid POST request that might fail
      // in a predictable way, like with a test email address.
      const response = await fetch(EMAIL_SERVICE_CONFIG.endpoint, {
        method: 'POST',
        mode: 'cors',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${EMAIL_SERVICE_CONFIG.apiKey}`,
          'apikey': EMAIL_SERVICE_CONFIG.apiKey
        },
        body: JSON.stringify({ emailType: 'welcome', email: 'test@example.com', data: {} })
      });
  
      if (response.ok) {
        return { success: true, message: 'Connection to email service is successful.' };
      } else {
        const errorText = await response.text();
        return { success: false, error: `Connection test failed with status ${response.status}: ${errorText}` };
      }
    } catch (error) {
      return { success: false, error: `A network error occurred: ${error.message}` };
    }
  }
  
  // Export the configuration for use in other parts of the application if needed.
  export { EMAIL_SERVICE_CONFIG };
  
  