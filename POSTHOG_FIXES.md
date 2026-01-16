# TunePal — PostHog Core Fix Guide v10

**Scope:** Fix core identity + email association issues and prevent analytics correctness failures (Vanilla JS + Vite + Electron + Supabase/Bolt Database + Supabase Edge Functions).

---

## Primary Goals

* **Email Consistency:** Emails consistently appear on PostHog persons after signup/login.
* **Identity Unification:** Client and Edge Function events unify under the same `distinct_id` (Supabase `user.id`).
* **Security & Privacy:** Logout clears identity to prevent cross-user leakage.
* **Data Integrity:** Environment tagging prevents dev/preview pollution (Beta treated as production).

---

## 1. Problem Statement

**Observed Issue:** Users firing `auth_signup_succeeded` / `auth_signin_succeeded` do not always have an email attached in PostHog Persons.

**Root Causes:**

* App captures auth success events without calling `posthog.identify()`.
* PostHog is configured with `person_profiles: 'identified_only'`, meaning anonymous events don't create enriched Persons.
* **Identity Fragmentation:** Edge Functions use Supabase `user.id`, but the browser stays anonymous unless `identify` runs.
* **Identity Leakage:** Logout doesn't call `posthog.reset()`, risking shared session data.

---

## 2. Fix 1 — Identify Users After Auth + Set Email

Add a single identity hook inside the existing auth state listener.

**Preferred Location:** `src/Auth/authGuard.js` — inside `handleAuthStateChange(event, session)`.

```javascript
// File: src/Auth/authGuard.js
import posthog from '../Config/posthog.js'

// Inside handleAuthStateChange(event, session)
// AFTER the shouldSuppressNotification early-return
// and AFTER you have access to session?.user

const user = session?.user
if (user?.id) {
  posthog.identify(user.id, {
    email: user.email || undefined,
    full_name: user.user_metadata?.full_name || undefined,
  })
}

```

### Verification

* **PostHog Live Events:** Confirm `distinct_id` becomes the Supabase `user.id`.
* **PostHog Persons:** Confirm email appears on the person profile (not just event properties).

---

## 3. Fix 2 — Ensure Events Are Captured After Identify

If success events fire before `identify`, they remain anonymous.

**Recommended:** Move auth success tracking into **AuthGuard**.

```javascript
// File: src/Auth/loginPage.js
// Just before calling signIn() or signUp():
sessionStorage.setItem('tp_last_auth_action', 'signin') // or 'signup'

// File: src/Auth/authGuard.js
// Inside handleAuthStateChange(event, session)
// AFTER suppression early-return and AFTER posthog.identify(...)

if (event === 'SIGNED_IN') {
  const action = sessionStorage.getItem('tp_last_auth_action')
  sessionStorage.removeItem('tp_last_auth_action')
  
  const eventName = action === 'signup' ? 'auth_signup_succeeded' : 'auth_signin_succeeded';
  
  posthog.capture(eventName, {
    auth_method: 'email_password',
    surface: 'login_modal'
  })
}

```

> [!IMPORTANT]
> If you implement this, remove the original `auth_*_succeeded` captures in `loginPage.js` to prevent duplicates.

---

## 4. Fix 3 — Prevent Identity Leakage

Without `posthog.reset()`, shared devices can leak identity and `tp_session_id` across users.

```javascript
// File: src/Auth/index.js
import posthog from '../Config/posthog.js'

export async function signOut(options = {}) {
  const { error } = await supabase.auth.signOut()
  if (error) return { error }

  // 1) Reset identity (clears distinct_id + super properties)
  posthog.reset()

  // 2) Re-register required super properties
  posthog.register({
    tp_app: 'tunepal',
    tp_env: import.meta.env.VITE_APP_ENV || 'development',
    tp_platform: import.meta.env.VITE_APP_PLATFORM || 'web',
    tp_genre: posthog.get_property('tp_genre') || 'techno',
    tp_session_id: crypto.randomUUID(),
  })

  // 3) Track sign-out
  posthog.capture('auth_signed_out', {
    surface: options.surface || 'unknown'
  })

  return { error: null }
}

```

---

## 5. Fix 4 & 5 — Server Side (Edge Functions)

Unify the client and server by ensuring both use the Supabase `user.id`. Use the existing helper in `supabase/functions/_shared/posthog.ts`.

```typescript
// File: supabase/functions/_shared/posthog.ts
export async function posthogCapture(options: {
  host?: string
  apiKey?: string
  distinctId: string
  event: string
  properties?: Record<string, any>
}) {
  const apiKey = options.apiKey || Deno.env.get('POSTHOG_PROJECT_API_KEY')
  if (!apiKey) return

  const host = options.host || Deno.env.get('POSTHOG_HOST') || 'https://us.i.posthog.com'
  
  const payload = {
    api_key: apiKey,
    event: options.event,
    properties: {
      ...(options.properties || {}),
      distinct_id: options.distinctId,
      $lib: 'deno-edge-function',
      tp_app: 'tunepal',
      tp_platform: 'server',
      tp_env: Deno.env.get('VITE_APP_ENV') || 'production',
    },
    timestamp: new Date().toISOString(),
  }

  await fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

```

---

## 6. Fix 6 — Correct Environment Tagging

Ensure `beta.tunepal.ai` is treated as **production** to isolate Vercel previews and local dev data.

```javascript
// File: src/Config/environment.js
const getEnvironment = () => {
  if (typeof window !== 'undefined' && window.location) {
    const hostname = window.location.hostname
    
    // Production: include beta
    if (
      hostname === 'tunepal.ai' ||
      hostname === 'www.tunepal.ai' ||
      hostname === 'beta.tunepal.ai'
    ) {
      return 'production'
    }

    // Vercel preview builds
    if (hostname.includes('vercel.app')) {
      return 'preview'
    }
  }
  return 'development'
}

```

---

## 7. Strategic Context: Why "Beta Essentials"?

These fixes are **correctness requirements**, not "extra" features. Without them:

1. **Fragmented Analytics:** Funnels and retention metrics are broken if IDs don't match.
2. **No Direct Communication:** Missing emails prevent matching power users to support records.
3. **Polluted Data:** Mixing dev/preview behavior with beta behavior muddies adoption metrics.

---

## 10. Final Checklist for PR

* [ ] `AuthGuard` identify hook added **AFTER** suppression early-return.
* [ ] `auth_signin_succeeded` and `auth_signup_succeeded` captured **AFTER** identify.
* [ ] `signOut` calls `posthog.reset()` to prevent identity leakage.
* [ ] Super properties re-registered after reset, including `tp_session_id` regeneration.
* [ ] Edge function capture uses `_shared/posthog.ts` shape.
* [ ] `environment.js` classifies `beta.tunepal.ai` as **production**.
* [ ] Verification: Email present in PostHog Persons; client + server events merged.

Would you like me to help you draft the specific **Pull Request description** for these changes?