export async function posthogCapture(options: {
    host?: string;
    apiKey?: string;
    distinctId: string;
    event: string;
    properties?: Record<string, any>;
}) {
    try {
        const host = options.host || Deno.env.get("POSTHOG_HOST") || "https://us.i.posthog.com";
        const apiKey = options.apiKey || Deno.env.get("POSTHOG_PROJECT_API_KEY");

        if (!apiKey) return;

        const payload = {
            api_key: apiKey,
            event: options.event,
            properties: {
                ...options.properties,
                distinct_id: options.distinctId,
                $lib: "deno-edge-function",
                tp_app: "tunepal",
                tp_platform: "server",
                tp_env: Deno.env.get("VITE_APP_ENV") || "production",
            },
            timestamp: new Date().toISOString(),
        };

        // Await to ensure the event is sent before the function terminates
        await fetch(`${host}/capture/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }).catch(err => console.error("PostHog fetch error:", err));

    } catch (err) {
        console.error("PostHog capture error (non-fatal):", err);
    }
}
