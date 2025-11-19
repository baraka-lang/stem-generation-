/**
 * Retry Helper Utility
 * Provides retry logic with exponential backoff for network requests
 */

/**
 * Sleep utility for delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {Function} options.onRetry - Callback on retry attempt
 * @returns {Promise<any>} - Result from successful function call
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    onRetry = null
  } = options

  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt === maxAttempts) {
        throw error
      }

      const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay)

      if (onRetry) {
        onRetry(attempt, maxAttempts, delay, error)
      }

      console.log(`[retry] Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`, error.message)

      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * Check if an error is retryable (network/temporary errors)
 * @param {Error} error - Error to check
 * @returns {boolean} - True if error should be retried
 */
export function isRetryableError(error) {
  const retryableMessages = [
    'Failed to send a request',
    'network error',
    'timeout',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'fetch failed',
    'NetworkError',
    'FunctionsFetchError'
  ]

  const errorMessage = error?.message?.toLowerCase() || ''
  const errorName = error?.name?.toLowerCase() || ''
  const errorString = errorMessage + ' ' + errorName

  return retryableMessages.some(msg =>
    errorString.includes(msg.toLowerCase())
  )
}

/**
 * Retry a Supabase edge function call
 * @param {Function} invokeFn - Function that returns supabase.functions.invoke promise
 * @param {Object} options - Retry options
 * @returns {Promise<{data: any, error: any}>} - Supabase response
 */
export async function retryEdgeFunctionCall(invokeFn, options = {}) {
  const {
    functionName = 'edge function',
    onRetry = null,
    ...retryOptions
  } = options

  return retryWithBackoff(
    async () => {
      const result = await invokeFn()

      if (result.error && isRetryableError(result.error)) {
        throw result.error
      }

      return result
    },
    {
      ...retryOptions,
      onRetry: (attempt, maxAttempts, delay, error) => {
        console.log(`[${functionName}] Retry ${attempt}/${maxAttempts} after ${delay}ms - ${error.message}`)
        if (onRetry) {
          onRetry(attempt, maxAttempts, delay, error)
        }
      }
    }
  )
}
