import posthog from 'posthog-js'

// Initialize PostHog
const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY || import.meta.env.VITE_POSTHOG_API_KEY
const posthogHost = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'

if (posthogKey) {
    posthog.init(posthogKey, {
        api_host: posthogHost,
        person_profiles: 'identified_only',
        autocapture: false,
        disable_session_recording: true,
        capture_pageview: false,
        // Reduce noise by filtering out default browser/environment properties
        properties_denylist: [
            '$screen_height', '$screen_width',
            '$viewport_height', '$viewport_width',
            '$lib', '$lib_version',
            '$browser_language', '$screen_density',
            '$initial_referrer', '$initial_referring_domain',
            '$current_url', '$pathname', '$host'
        ]
    })

    // Global properties (super-properties)
    posthog.register({
        tp_app: "tunepal",
        tp_env: import.meta.env.VITE_APP_ENV || 'development',
        tp_platform: import.meta.env.VITE_APP_PLATFORM || 'web',
        tp_genre: "techno",
        tp_session_id: crypto.randomUUID()
    })
} else {
    console.warn('PostHog API Key not found. Analytics will not be initialized.')
}

export default posthog
