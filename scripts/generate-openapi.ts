// === OPENAPI GENERATOR ===
// Generates OpenAPI spec from running server

import { execSync } from "child_process";
import { writeFileSync } from "fs";

const OPENAPI_URL = "http://localhost:3000/api/openapi";
const OUTPUT_FILE = "generated-openapi.json";

async function main() {
  console.log("Generating OpenAPI spec from running server...");
  
  try {
    // Fetch OpenAPI spec from running server
    const response = await fetch(OPENAPI_URL);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
    }
    
    const openApiSpec = await response.json();
    
    // Write to file
    writeFileSync(OUTPUT_FILE, JSON.stringify(openApiSpec, null, 2));
    
    console.log(`OpenAPI spec generated: ${OUTPUT_FILE}`);
    console.log(`Size: ${JSON.stringify(openApiSpec).length} characters`);
    
  } catch (error) {
    console.error("Failed to generate OpenAPI spec:", error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("OpenAPI generation failed:", error);
    process.exit(1);
  });
}

export { main as generateOpenAPI };
