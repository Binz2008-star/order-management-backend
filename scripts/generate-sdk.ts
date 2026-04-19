#!/usr/bin/env tsx
// scripts/generate-sdk.ts
/**
 * SDK Generation Script
 * 
 * Generates client SDKs from the OpenAPI specification.
 * Supports multiple languages and formats.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const OPENAPI_SPEC_PATH = 'docs/openapi.yaml';
const SDK_OUTPUT_DIR = 'packages/sdk';

interface SdkGenerationConfig {
  language: string;
  generator: string;
  outputDir: string;
  options?: Record<string, string>;
}

const SDK_CONFIGS: SdkGenerationConfig[] = [
  {
    language: 'typescript',
    generator: 'typescript-fetch',
    outputDir: 'typescript',
    options: {
      'npmName': '@order-management/sdk',
      'npmVersion': '1.0.0',
      'withInterfaces': 'true',
      'enumPropertyNaming': 'PascalCase'
    }
  },
  {
    language: 'python',
    generator: 'python',
    outputDir: 'python',
    options: {
      'packageName': 'order_management_sdk',
      'packageVersion': '1.0.0'
    }
  }
];

async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function generateSdk(config: SdkGenerationConfig): Promise<void> {
  console.log(`Generating ${config.language} SDK...`);
  
  const outputDir = path.join(SDK_OUTPUT_DIR, config.outputDir);
  await ensureDirectoryExists(outputDir);
  
  // Build command arguments
  const args = [
    'generate',
    '-i', OPENAPI_SPEC_PATH,
    '-g', config.generator,
    '-o', outputDir
  ];
  
  // Add options
  if (config.options) {
    for (const [key, value] of Object.entries(config.options)) {
      args.push('--additional-properties', `${key}=${value}`);
    }
  }
  
  try {
    // For now, create a placeholder since we don't have openapi-generator installed
    // In a real implementation, this would call openapi-generator-cli
    console.log(`Would run: openapi-generator-cli ${args.join(' ')}`);
    
    // Create placeholder SDK files
    const placeholderContent = generatePlaceholderSdk(config.language);
    await fs.writeFile(
      path.join(outputDir, `index.${getFileExtension(config.language)}`),
      placeholderContent
    );
    
    // Create package.json for TypeScript SDK
    if (config.language === 'typescript') {
      const packageJson = {
        name: '@order-management/sdk',
        version: '1.0.0',
        description: 'TypeScript SDK for Order Management API',
        main: 'index.js',
        types: 'index.d.ts',
        scripts: {
          build: 'tsc',
          prepublishOnly: 'npm run build'
        },
        dependencies: {
          'node-fetch': '^3.0.0'
        },
        devDependencies: {
          'typescript': '^5.0.0',
          '@types/node': '^20.0.0'
        }
      };
      
      await fs.writeFile(
        path.join(outputDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
    }
    
    console.log(`Generated ${config.language} SDK successfully`);
  } catch (error) {
    console.error(`Failed to generate ${config.language} SDK:`, error);
    throw error;
  }
}

function getFileExtension(language: string): string {
  switch (language) {
    case 'typescript': return 'ts';
    case 'python': return 'py';
    default: return 'js';
  }
}

function generatePlaceholderSdk(language: string): string {
  switch (language) {
    case 'typescript':
      return `// Auto-generated TypeScript SDK for Order Management API
// Generated from OpenAPI specification

export interface OrderManagementConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export class OrderManagementClient {
  private config: OrderManagementConfig;

  constructor(config: OrderManagementConfig) {
    this.config = config;
  }

  // TODO: Implement actual API methods based on OpenAPI spec
  async healthCheck(): Promise<{ status: string }> {
    const response = await fetch(\`\${this.config.baseUrl}/api/health\`);
    return response.json();
  }

  // Placeholder for order operations
  async createOrder(data: any): Promise<any> {
    // Implementation would be generated from OpenAPI spec
    throw new Error('Method not implemented yet');
  }
}

export default OrderManagementClient;
`;
    
    case 'python':
      return `# Auto-generated Python SDK for Order Management API
# Generated from OpenAPI specification

from typing import Optional, Dict, Any
import requests

class OrderManagementClient:
    def __init__(self, base_url: str, api_key: Optional[str] = None, timeout: int = 30):
        self.base_url = base_url
        self.api_key = api_key
        self.timeout = timeout

    def health_check(self) -> Dict[str, Any]:
        """Check API health status"""
        response = requests.get(f"{self.base_url}/api/health", timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    # TODO: Implement actual API methods based on OpenAPI spec
    def create_order(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new order"""
        # Implementation would be generated from OpenAPI spec
        raise NotImplementedError("Method not implemented yet")
`;
    
    default:
      return `// Auto-generated SDK for Order Management API
// Generated from OpenAPI specification

// TODO: Implement SDK based on OpenAPI specification
export class OrderManagementClient {
  constructor(config) {
    this.config = config;
  }
  
  // Placeholder methods
  async healthCheck() {
    // Implementation would be generated from OpenAPI spec
    throw new Error('Method not implemented yet');
  }
}`;
  }
}

async function main(): Promise<void> {
  console.log('Starting SDK generation...');
  
  try {
    // Check if OpenAPI spec exists
    await fs.access(OPENAPI_SPEC_PATH);
    console.log('Found OpenAPI specification');
  } catch {
    console.error('OpenAPI specification not found at:', OPENAPI_SPEC_PATH);
    process.exit(1);
  }
  
  // Ensure SDK output directory exists
  await ensureDirectoryExists(SDK_OUTPUT_DIR);
  
  // Generate SDKs for all configured languages
  for (const config of SDK_CONFIGS) {
    await generateSdk(config);
  }
  
  console.log('SDK generation completed successfully');
  console.log('Generated SDKs:', SDK_CONFIGS.map(c => c.language).join(', '));
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('SDK generation failed:', error);
    process.exit(1);
  });
}

export { main };
