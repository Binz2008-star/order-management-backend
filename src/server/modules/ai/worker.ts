// === AI WORKER PROCESS ===
// Production-safe background processing for AI operations

import { PrismaClient } from "@prisma/client";
import { Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { EmbeddingService } from "./embedding.service";
import { RetrievalService } from "./retrieval.service";

// === WORKER CONFIGURATION ===

interface WorkerConfig {
  redisUrl: string;
  concurrency: number;
  maxRetries: number;
  backoffType: "exponential" | "fixed" | "linear";
}

interface AIJobData {
  sellerId: string;
  jobType: "FULL_REINDEX" | "INCREMENTAL_UPDATE" | "EMBEDDING_GENERATION" | "INDEX_OPTIMIZATION";
  payload?: Record<string, any>;
}

interface AIJobResult {
  success: boolean;
  processed: number;
  errors: string[];
  metadata?: Record<string, any>;
}

// === AI WORKER CLASS ===

export class AIWorker {
  private redis: Redis;
  private prisma: PrismaClient;
  private queue: Queue;
  private worker!: Worker;
  private embeddingService: EmbeddingService;
  private documentService: DocumentService;
  private retrievalService: RetrievalService;
  private circuitBreaker: AiCircuitBreakerService;
  private config: WorkerConfig;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.prisma = new PrismaClient();
    this.queue = new Queue("ai-queue", {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: config.maxRetries,
        backoff: {
          type: config.backoffType,
          delay: 2000,
        },
      },
    });

    this.circuitBreaker = new AiCircuitBreakerService();
    this.embeddingService = new EmbeddingService();
    this.documentService = new DocumentService(this.prisma, this.embeddingService);
    this.retrievalService = new RetrievalService(this.prisma);
  }

  // === WORKER LIFECYCLE ===

  async start(): Promise<void> {
    console.log("Starting AI worker...");

    this.worker = new Worker(
      "ai-queue",
      async (job: Job<AIJobData>) => {
        return await this.processJob(job);
      },
      {
        connection: this.redis,
        concurrency: this.config.concurrency,
        limiter: {
          max: 10,
          duration: 60000, // 10 jobs per minute per seller
          groupKey: (job: Job) => job.data.sellerId,
        },
      }
    );

    this.worker.on("completed", (job: Job, result: AIJobResult) => {
      console.log(`Job ${job.id} completed for seller ${job.data.sellerId}`, {
        processed: result.processed,
        errors: result.errors.length,
      });
    });

    this.worker.on("failed", (job: Job, err: Error) => {
      console.error(`Job ${job.id} failed for seller ${job.data.sellerId}:`, err.message);
    });

    this.worker.on("error", (err: Error) => {
      console.error("Worker error:", err);
    });

    await this.worker.waitUntilReady();
    console.log("AI worker started successfully");
  }

  async stop(): Promise<void> {
    console.log("Stopping AI worker...");

    if (this.worker) {
      await this.worker.close();
    }

    if (this.queue) {
      await this.queue.close();
    }

    await this.redis.quit();
    await this.prisma.$disconnect();

    console.log("AI worker stopped");
  }

  // === JOB PROCESSING ===

  private async processJob(job: Job<AIJobData>): Promise<AIJobResult> {
    const { sellerId, jobType, payload } = job.data;

    console.log(`Processing ${jobType} job for seller ${sellerId}`);

    // Create job log entry
    const jobLog = await this.prisma.aiIndexJob.create({
      data: {
        sellerId,
        jobType,
        status: "RUNNING",
        payloadJson: JSON.stringify(payload || {}),
      },
    });

    const result: AIJobResult = {
      success: false,
      processed: 0,
      errors: [],
    };

    try {
      switch (jobType) {
        case "FULL_REINDEX":
          result.processed = await this.processFullReindex(sellerId, payload);
          result.success = true;
          break;

        case "INCREMENTAL_UPDATE":
          result.processed = await this.processIncrementalUpdate(sellerId, payload);
          result.success = true;
          break;

        case "EMBEDDING_GENERATION":
          result.processed = await this.processEmbeddingGeneration(sellerId, payload);
          result.success = true;
          break;

        case "INDEX_OPTIMIZATION":
          result.processed = await this.processIndexOptimization(sellerId, payload);
          result.success = true;
          break;

        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }

      // Update job log on success
      await this.prisma.aiIndexJob.update({
        where: { id: jobLog.id },
        data: { status: "COMPLETED" },
      });

    } catch (error) {
      console.error(`Job ${job.id} processing failed:`, error);
      result.errors.push(error.message);

      // Update job log on failure
      await this.prisma.aiIndexJob.update({
        where: { id: jobLog.id },
        data: {
          status: "FAILED",
          lastError: error.message,
          attemptCount: { increment: 1 },
        },
      });
    }

    return result;
  }

  // === JOB TYPE HANDLERS ===

  private async processFullReindex(sellerId: string, payload?: Record<string, any>): Promise<number> {
    console.log(`Starting full reindex for seller ${sellerId}`);

    // Deactivate existing documents
    await this.prisma.aiDocument.updateMany({
      where: { sellerId, isActive: true },
      data: { isActive: false },
    });

    let processed = 0;

    // Index products
    const products = await this.prisma.product.findMany({
      where: { sellerId },
      include: { seller: true },
    });

    for (const product of products) {
      try {
        await this.indexingService.indexProduct(product);
        processed++;
      } catch (error) {
        console.error(`Failed to index product ${product.id}:`, error);
      }
    }

    // Index seller policies/help content
    const policyDocuments = await this.generatePolicyDocuments(sellerId);
    for (const document of policyDocuments) {
      try {
        await this.indexingService.indexDocument(document);
        processed++;
      } catch (error) {
        console.error(`Failed to index policy document:`, error);
      }
    }

    console.log(`Full reindex completed for seller ${sellerId}. Processed ${processed} items`);
    return processed;
  }

  private async processIncrementalUpdate(sellerId: string, payload?: Record<string, any>): Promise<number> {
    console.log(`Starting incremental update for seller ${sellerId}`);

    const { sourceType, sourceId } = payload || {};
    let processed = 0;

    if (sourceType === "PRODUCT" && sourceId) {
      const product = await this.prisma.product.findFirst({
        where: { id: sourceId, sellerId },
        include: { seller: true },
      });

      if (product) {
        await this.indexingService.indexProduct(product);
        processed = 1;
      }
    } else if (sourceType === "POLICY") {
      const policyDocuments = await this.generatePolicyDocuments(sellerId);
      for (const document of policyDocuments) {
        await this.indexingService.indexDocument(document);
        processed++;
      }
    }

    console.log(`Incremental update completed for seller ${sellerId}. Processed ${processed} items`);
    return processed;
  }

  private async processEmbeddingGeneration(sellerId: string, payload?: Record<string, any>): Promise<number> {
    console.log(`Starting embedding generation for seller ${sellerId}`);

    // Get unprocessed chunks
    const chunks = await this.prisma.aiDocumentChunk.findMany({
      where: {
        sellerId,
        embedding: null,
      },
      include: {
        document: true,
      },
      take: 100, // Process in batches
    });

    let processed = 0;

    for (const chunk of chunks) {
      try {
        const embedding = await this.embeddingService.generateEmbedding(chunk.content);

        await this.prisma.aiDocumentChunk.update({
          where: { id: chunk.id },
          data: { embedding },
        });

        processed++;
      } catch (error) {
        console.error(`Failed to generate embedding for chunk ${chunk.id}:`, error);
      }
    }

    console.log(`Embedding generation completed for seller ${sellerId}. Processed ${processed} chunks`);
    return processed;
  }

  private async processIndexOptimization(sellerId: string, payload?: Record<string, any>): Promise<number> {
    console.log(`Starting index optimization for seller ${sellerId}`);

    // Get document count for this seller
    const documentCount = await this.prisma.aiDocument.count({
      where: { sellerId, isActive: true },
    });

    let processed = 0;

    // Optimize based on document count
    if (documentCount > 1000) {
      // Rebuild with optimized parameters
      await this.retrievalService.optimizeIndex(sellerId, {
        indexType: "HNSW",
        m: 16,
        efConstruction: 64,
      });
      processed = 1;
    } else if (documentCount > 100) {
      // Use IVFFlat with optimized lists
      await this.retrievalService.optimizeIndex(sellerId, {
        indexType: "IVFFlat",
        lists: Math.min(documentCount / 10, 100),
      });
      processed = 1;
    }

    console.log(`Index optimization completed for seller ${sellerId}. Processed ${processed} optimizations`);
    return processed;
  }

  // === UTILITY METHODS ===

  private async generatePolicyDocuments(sellerId: string): Promise<Array<{
    sellerId: string;
    domain: string;
    sourceType: string;
    title: string;
    bodyText: string;
    languageCode: string;
  }>> {
    const documents = [];

    // Generate help/policy documents based on seller data
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
    });

    if (seller) {
      documents.push({
        sellerId,
        domain: "SELLER_KNOWLEDGE",
        sourceType: "POLICY",
        title: `${seller.brandName} Order Policy`,
        bodyText: `Order processing policy for ${seller.brandName}. Orders are processed in the order they are received. Delivery times vary based on location.`,
        languageCode: "en",
      });

      documents.push({
        sellerId,
        domain: "SUPPORT",
        sourceType: "FAQ",
        title: "Common Order Questions",
        bodyText: `Frequently asked questions about orders with ${seller.brandName}. How to track orders, delivery times, payment methods, and return policies.`,
        languageCode: "en",
      });
    }

    return documents;
  }

  // === QUEUE MANAGEMENT ===

  async addJob(data: AIJobData, options?: { delay?: number; priority?: number }): Promise<Job<AIJobData>> {
    return await this.queue.add(data.jobType, data, {
      delay: options?.delay,
      priority: options?.priority,
      removeOnComplete: 100,
      removeOnFail: 50,
    });
  }

  async getJobStatus(jobId: string): Promise<Job<AIJobData> | null> {
    return await this.queue.getJob(jobId);
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }

  async pauseQueue(): Promise<void> {
    await this.queue.pause();
  }

  async resumeQueue(): Promise<void> {
    await this.queue.resume();
  }
}

// === WORKER FACTORY ===

export class AIWorkerFactory {
  private static workers: Map<string, AIWorker> = new Map();

  static createWorker(config: WorkerConfig): AIWorker {
    const workerId = `worker-${Date.now()}`;
    const worker = new AIWorker(config);
    this.workers.set(workerId, worker);
    return worker;
  }

  static async shutdownAll(): Promise<void> {
    const shutdownPromises = Array.from(this.workers.values()).map(worker => worker.stop());
    await Promise.all(shutdownPromises);
    this.workers.clear();
  }
}

// === MAIN EXECUTION ===

async function main() {
  const config: WorkerConfig = {
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    concurrency: parseInt(process.env.AI_WORKER_CONCURRENCY || "5"),
    maxRetries: parseInt(process.env.AI_WORKER_MAX_RETRIES || "3"),
    backoffType: "exponential",
  };

  const worker = AIWorkerFactory.createWorker(config);

  try {
    await worker.start();

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log("Received SIGINT, shutting down gracefully...");
      await worker.stop();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("Received SIGTERM, shutting down gracefully...");
      await worker.stop();
      process.exit(0);
    });

    // Keep the process running
    console.log("AI worker is running. Press Ctrl+C to stop.");

  } catch (error) {
    console.error("Failed to start AI worker:", error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
