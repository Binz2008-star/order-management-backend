/**
 * Secure HTTP Client Wrapper
 *
 * Provides a secure wrapper around fetch with proper error handling,
 * timeouts, and security controls to prevent bypassable HTTP patterns.
 */

export interface HttpClientResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export interface HttpClientOptions {
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

export class HttpClient {
  private static readonly DEFAULT_TIMEOUT = 10000; // 10 seconds
  private static readonly DEFAULT_RETRIES = 3;
  private static readonly DEFAULT_RETRY_DELAY = 1000; // 1 second

  /**
   * Make a secure HTTP request with proper error handling and timeouts
   */
  static async request<T = unknown>(
    url: string,
    options: RequestInit & { timeout?: number; retries?: number; retryDelay?: number } = {}
  ): Promise<HttpClientResponse<T>> {
    const {
      timeout = this.DEFAULT_TIMEOUT,
      retries = this.DEFAULT_RETRIES,
      retryDelay = this.DEFAULT_RETRY_DELAY,
      ...fetchOptions
    } = options;

    let lastError: Error;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.makeRequestWithTimeout<T>(url, {
          ...fetchOptions,
          timeout,
        });

        return response;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx) or if we've exhausted retries
        if (error instanceof HttpClientError && error.status >= 400 && error.status < 500) {
          throw error;
        }

        if (attempt === retries) {
          throw lastError;
        }

        // Wait before retry
        await this.delay(retryDelay * Math.pow(2, attempt)); // Exponential backoff
      }
    }

    throw lastError!;
  }

  /**
   * Make GET request
   */
  static async get<T = unknown>(
    url: string,
    options: Omit<HttpClientOptions, 'method'> = {}
  ): Promise<HttpClientResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  /**
   * Make POST request
   */
  static async post<T = unknown>(
    url: string,
    data?: unknown,
    options: Omit<HttpClientOptions, 'method' | 'body'> = {}
  ): Promise<HttpClientResponse<T>> {
    return this.request<T>(url, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  /**
   * Make PUT request
   */
  static async put<T = unknown>(
    url: string,
    data?: unknown,
    options: Omit<HttpClientOptions, 'method' | 'body'> = {}
  ): Promise<HttpClientResponse<T>> {
    return this.request<T>(url, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  /**
   * Make DELETE request
   */
  static async delete<T = unknown>(
    url: string,
    options: Omit<HttpClientOptions, 'method'> = {}
  ): Promise<HttpClientResponse<T>> {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }

  private static async makeRequestWithTimeout<T>(
    url: string,
    options: RequestInit & { timeout: number }
  ): Promise<HttpClientResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new HttpClientError(
          `HTTP request failed with status ${response.status}`,
          response.status,
          await response.text()
        );
      }

      const data = await response.json();

      return {
        data,
        status: response.status,
        headers: response.headers,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpClientError(`Request timeout after ${options.timeout}ms`, 408);
      }

      throw error;
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export class HttpClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public responseText?: string
  ) {
    super(message);
    this.name = 'HttpClientError';
  }
}

/**
 * Upstash-specific HTTP client with proper authentication
 */
export class UpstashHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) { }

  /**
   * Execute Redis command via Upstash REST API
   */
  async executeCommand<T = unknown>(command: string[]): Promise<T> {
    const encodedCommand = command.map(part => encodeURIComponent(part)).join('/');
    const url = `${this.baseUrl}/${encodedCommand}`;

    const response = await HttpClient.get<T>(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    return response.data;
  }

  /**
   * Execute Redis pipeline via Upstash REST API
   */
  async executePipeline<T = unknown>(commands: string[][]): Promise<T[]> {
    const response = await HttpClient.post<T[]>(
      `${this.baseUrl}/pipeline`,
      commands,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  /**
   * Execute SET command with options
   */
  async set(key: string, value: string, options?: {
    NX?: boolean;
    EX?: number;
    PX?: number;
  }): Promise<string | null> {
    const command = ['SET', key, value];

    if (options?.NX) command.push('NX');
    if (options?.EX) command.push('EX', options.EX.toString());
    if (options?.PX) command.push('PX', options.PX.toString());

    return this.executeCommand<string | null>(command);
  }

  /**
   * Execute GET command
   */
  async get(key: string): Promise<string | null> {
    return this.executeCommand<string | null>(['GET', key]);
  }

  /**
   * Execute INCR command
   */
  async incr(key: string): Promise<number> {
    return this.executeCommand<number>(['INCR', key]);
  }

  /**
   * Execute DEL command
   */
  async del(key: string): Promise<number> {
    return this.executeCommand<number>(['DEL', key]);
  }

  /**
   * Execute EXPIRE command
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    const result = await this.executeCommand<number>(['EXPIRE', key, seconds.toString()]);
    return result === 1;
  }
}
