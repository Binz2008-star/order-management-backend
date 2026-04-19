#!/usr/bin/env tsx
// scripts/release-discipline.ts
/**
 * Release Discipline Script
 *
 * Enforces release validation and deployment checks.
 * Ensures all quality gates pass before release.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';

interface ReleaseCheck {
  name: string;
  check: () => Promise<boolean>;
  critical: boolean;
  errorMessage?: string;
}

class ReleaseDiscipline {
  private checks: ReleaseCheck[] = [];

  constructor() {
    this.setupChecks();
  }

  private setupChecks(): void {
    // Code quality checks
    this.checks.push({
      name: 'typecheck',
      critical: true,
      check: async () => {
        try {
          execSync('npm run typecheck', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
      errorMessage: 'TypeScript compilation failed'
    });

    this.checks.push({
      name: 'lint',
      critical: true,
      check: async () => {
        try {
          execSync('npm run lint', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
      errorMessage: 'Linting failed'
    });

    // Test checks
    this.checks.push({
      name: 'unit-tests',
      critical: true,
      check: async () => {
        try {
          execSync('npm run test:unit', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
      errorMessage: 'Unit tests failed'
    });

    this.checks.push({
      name: 'integration-tests',
      critical: true,
      check: async () => {
        try {
          execSync('npm run test:integration', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
      errorMessage: 'Integration tests failed'
    });

    // Security and compliance checks
    this.checks.push({
      name: 'production-hardening',
      critical: true,
      check: async () => {
        try {
          execSync('npm run verify:prod', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
      errorMessage: 'Production hardening validation failed'
    });

    // API contract checks
    this.checks.push({
      name: 'openapi-sync',
      critical: true,
      check: async () => {
        return await this.checkOpenApiSync();
      },
      errorMessage: 'OpenAPI specification sync validation failed'
    });

    this.checks.push({
      name: 'contract-tests',
      critical: true,
      check: async () => {
        try {
          execSync('npm run test:contract', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
      errorMessage: 'Contract tests failed'
    });

    // Build checks
    this.checks.push({
      name: 'build',
      critical: true,
      check: async () => {
        try {
          execSync('npm run build', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
      errorMessage: 'Build failed'
    });

    // SDK generation check
    this.checks.push({
      name: 'sdk-generation',
      critical: false,
      check: async () => {
        try {
          execSync('npm run generate:sdk', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
      errorMessage: 'SDK generation failed'
    });

    // Environment validation
    this.checks.push({
      name: 'environment-validation',
      critical: true,
      check: async () => {
        return await this.validateEnvironment();
      },
      errorMessage: 'Environment validation failed'
    });
  }

  private async checkOpenApiSync(): Promise<boolean> {
    try {
      // Check if OpenAPI spec exists
      await fs.access('docs/openapi.yaml');

      // Basic validation that spec is not empty
      const spec = await fs.readFile('docs/openapi.yaml', 'utf-8');
      if (spec.trim().length === 0) {
        return false;
      }

      // Check for required OpenAPI structure
      return spec.includes('openapi:') && spec.includes('paths:') && spec.includes('info:');
    } catch {
      return false;
    }
  }

  private async validateEnvironment(): Promise<boolean> {
    const requiredEnvVars = [
      'DATABASE_URL',
      'JWT_SECRET'
    ];

    const optionalEnvVars = [
      'REDIS_URL',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'PLATFORM_API_URL',
      'PLATFORM_API_KEY'
    ];

    // Check required environment variables
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        return false;
      }
    }

    // Validate JWT secret strength
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret && jwtSecret.length < 32) {
      console.error('JWT_SECRET must be at least 32 characters');
      return false;
    }

    // Check if at least one Redis configuration is present
    const hasRedis = process.env.REDIS_URL ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

    if (!hasRedis) {
      console.warn('Warning: No Redis configuration found - rate limiting will use memory fallback');
    }

    return true;
  }

  async runReleaseChecks(): Promise<{ success: boolean; results: Array<{ name: string; passed: boolean; critical: boolean; error?: string }> }> {
    console.log('Running release discipline checks...\n');

    const results = [];
    let criticalFailures = 0;

    for (const check of this.checks) {
      console.log(`Running: ${check.name}`);

      try {
        const passed = await check.check();
        results.push({
          name: check.name,
          passed,
          critical: check.critical
        });

        if (passed) {
          console.log(`  \u2713 ${check.name} passed`);
        } else {
          console.log(`  \u2717 ${check.name} failed`);
          if (check.critical) {
            criticalFailures++;
            console.error(`    ${check.errorMessage || 'Critical check failed'}`);
          } else {
            console.warn(`    ${check.errorMessage || 'Non-critical check failed'}`);
          }
        }
      } catch (error) {
        results.push({
          name: check.name,
          passed: false,
          critical: check.critical,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        console.log(`  \u2717 ${check.name} failed with error`);
        if (check.critical) {
          criticalFailures++;
          console.error(`    Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } else {
          console.warn(`    Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    console.log('\n=== Release Discipline Results ===');
    console.log(`Total checks: ${results.length}`);
    console.log(`Passed: ${results.filter(r => r.passed).length}`);
    console.log(`Failed: ${results.filter(r => !r.passed).length}`);
    console.log(`Critical failures: ${criticalFailures}`);

    if (criticalFailures > 0) {
      console.log('\n\u2717 RELEASE BLOCKED - Critical failures detected');
      const failedCritical = results.filter(r => !r.passed && r.critical);
      console.log('Critical failures:');
      failedCritical.forEach(r => {
        console.log(`  - ${r.name}: ${r.error || r.errorMessage || 'Unknown error'}`);
      });
    } else {
      console.log('\n\u2713 RELEASE APPROVED - All critical checks passed');
    }

    return {
      success: criticalFailures === 0,
      results
    };
  }

  async generateReleaseProof(): Promise<void> {
    console.log('Generating release proof...');

    const result = await this.runReleaseChecks();

    const proofData = {
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      commit: this.getCurrentGitCommit(),
      branch: this.getCurrentGitBranch(),
      checks: result.results,
      summary: {
        total: result.results.length,
        passed: result.results.filter(r => r.passed).length,
        failed: result.results.filter(r => !r.passed).length,
        criticalFailures: result.results.filter(r => !r.passed && r.critical).length
      },
      approved: result.success
    };

    // Write release proof to file
    const proofPath = `release-proof-${Date.now()}.json`;
    await fs.writeFile(proofPath, JSON.stringify(proofData, null, 2));

    console.log(`Release proof generated: ${proofPath}`);

    if (!result.success) {
      process.exit(1);
    }
  }

  private getCurrentGitCommit(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private getCurrentGitBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const discipline = new ReleaseDiscipline();
  await discipline.generateReleaseProof();
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Release discipline check failed:', error);
    process.exit(1);
  });
}

export { ReleaseDiscipline };

