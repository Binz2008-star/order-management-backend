/**
 * Single startup validation point
 * This is the ONLY place where validateProductionEnv() should be called
 */

import { validateProductionEnv } from './env'

// Execute startup validation immediately on import
console.log('Starting application validation...')
validateProductionEnv()
console.log('Application validation completed successfully')

export function startupComplete(): void {
  console.log('Application startup complete')
}
