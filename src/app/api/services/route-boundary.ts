/**
 * Route Boundary Layer
 * 
 * This file provides boundary functions for API routes
 * without exposing server internals.
 */

export interface RouteResponse {
  success: boolean;
  data?: any;
  error?: string;
  status?: number;
}

export interface RouteHandler {
  (request: Request): Promise<Response>;
}

/**
 * Create a standardized route response
 */
export function createRouteResponse(
  success: boolean,
  data?: any,
  error?: string,
  status?: number
): Response {
  const body: RouteResponse = {
    success,
    data,
    error,
    status,
  };

  return new Response(JSON.stringify(body), {
    status: status || (success ? 200 : 400),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create a route handler with error handling
 */
export function createRouteHandler(
  handler: (request: Request) => Promise<Response>
): RouteHandler {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (error) {
      console.error('Route handler error:', error);
      return createRouteResponse(
        false,
        null,
        error instanceof Error ? error.message : 'Internal server error',
        500
      );
    }
  };
}

/**
 * Validate JSON request body
 */
export async function validateJsonBody<T>(
  request: Request,
  schema?: { parse: (data: any) => T }
): Promise<T> {
  const body = await request.json();
  
  if (schema) {
    return schema.parse(body);
  }
  
  return body as T;
}

/**
 * Create error response
 */
export function createErrorResponse(
  message: string,
  status: number = 400
): Response {
  return createRouteResponse(false, null, message, status);
}

/**
 * Create success response
 */
export function createSuccessResponse(
  data?: any,
  status: number = 200
): Response {
  return createRouteResponse(true, data, undefined, status);
}
