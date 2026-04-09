import * as CircuitBreaker from 'opossum';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
}

export class AiCircuitBreakerService {
  private embeddingBreaker: CircuitBreaker;
  private rerankBreaker: CircuitBreaker;
  private retrievalBreaker: CircuitBreaker;

  constructor() {
    // Embedding circuit breaker - strict timeout
    this.embeddingBreaker = new CircuitBreaker(this.mockEmbeddingCall, {
      timeout: 5000, // 5s timeout
      errorThresholdPercentage: 50, // Open if 50% fail
      resetTimeout: 30000, // Try again after 30s
    });

    // Reranking circuit breaker - more lenient
    this.rerankBreaker = new CircuitBreaker(this.mockRerankCall, {
      timeout: 3000, // 3s timeout
      errorThresholdPercentage: 60, // Open if 60% fail
      resetTimeout: 15000, // Try again after 15s
    });

    // Retrieval circuit breaker - most critical
    this.retrievalBreaker = new CircuitBreaker(this.mockRetrievalCall, {
      timeout: 1000, // 1s timeout
      errorThresholdPercentage: 40, // Open if 40% fail
      resetTimeout: 10000, // Try again after 10s
    });

    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Embedding breaker events
    this.embeddingBreaker.on('open', () => {
      console.warn('Embedding circuit breaker OPEN - falling back to cached results');
    });

    this.embeddingBreaker.on('halfOpen', () => {
      console.info('Embedding circuit breaker HALF-OPEN - testing recovery');
    });

    // Reranking breaker events
    this.rerankBreaker.on('open', () => {
      console.warn('Reranking circuit breaker OPEN - using vector-only results');
    });

    this.rerankBreaker.on('halfOpen', () => {
      console.info('Reranking circuit breaker HALF-OPEN - testing recovery');
    });

    // Retrieval breaker events
    this.retrievalBreaker.on('open', () => {
      console.error('Retrieval circuit breaker OPEN - search unavailable');
    });

    this.retrievalBreaker.on('halfOpen', () => {
      console.info('Retrieval circuit breaker HALF-OPEN - testing recovery');
    });
  }

  async executeWithEmbeddingBreaker<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    this.embeddingBreaker.fire(operation);
    
    if (this.embeddingBreaker.opened) {
      if (fallback) {
        return await fallback();
      }
      throw new Error('Embedding service unavailable');
    }

    return operation();
  }

  async executeWithRerankBreaker<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    this.rerankBreaker.fire(operation);
    
    if (this.rerankBreaker.opened) {
      if (fallback) {
        return await fallback();
      }
      throw new Error('Reranking service unavailable');
    }

    return operation();
  }

  async executeWithRetrievalBreaker<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    this.retrievalBreaker.fire(operation);
    
    if (this.retrievalBreaker.opened) {
      if (fallback) {
        return await fallback();
      }
      throw new Error('Retrieval service unavailable');
    }

    return operation();
  }

  // Mock methods for circuit breaker testing
  private async mockEmbeddingCall(): Promise<any> {
    // This would be your actual embedding call
    return { embedding: [0.1, 0.2, 0.3] };
  }

  private async mockRerankCall(): Promise<any> {
    // This would be your actual reranking call
    return { rerankedResults: [] };
  }

  private async mockRetrievalCall(): Promise<any> {
    // This would be your actual retrieval call
    return { results: [] };
  }

  getCircuitBreakerStatus() {
    return {
      embedding: {
        state: this.embeddingBreaker.stats.state,
        failures: this.embeddingBreaker.stats.failures,
        successes: this.embeddingBreaker.stats.successes,
        timeouts: this.embeddingBreaker.stats.timeouts,
      },
      rerank: {
        state: this.rerankBreaker.stats.state,
        failures: this.rerankBreaker.stats.failures,
        successes: this.rerankBreaker.stats.successes,
        timeouts: this.rerankBreaker.stats.timeouts,
      },
      retrieval: {
        state: this.retrievalBreaker.stats.state,
        failures: this.retrievalBreaker.stats.failures,
        successes: this.retrievalBreaker.stats.successes,
        timeouts: this.retrievalBreaker.stats.timeouts,
      },
    };
  }

  // Force open a circuit breaker (for testing)
  forceOpenEmbeddingBreaker() {
    this.embeddingBreaker.open();
  }

  forceOpenRerankBreaker() {
    this.rerankBreaker.open();
  }

  forceOpenRetrievalBreaker() {
    this.retrievalBreaker.open();
  }

  // Reset all circuit breakers
  resetAll() {
    this.embeddingBreaker.close();
    this.rerankBreaker.close();
    this.retrievalBreaker.close();
  }
}

// Singleton instance
export const aiCircuitBreaker = new AiCircuitBreakerService();
