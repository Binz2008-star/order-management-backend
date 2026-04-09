import { Queue, Worker, QueueScheduler } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { DocumentService } from './document.service';
import { EmbeddingService } from './embedding.service';

export interface IndexingJobData {
  sellerId: string;
  jobType: 'FULL_REINDEX' | 'UPSERT_DOCUMENT' | 'DELETE_DOCUMENT';
  sourceType?: string;
  sourceId?: string;
  documentId?: string;
}

export interface IndexingJobResult {
  success: boolean;
  processed: number;
  errors: string[];
  duration: number;
}

export class AiQueueService {
  private indexingQueue: Queue;
  private worker: Worker;
  private scheduler: QueueScheduler;
  private redis: IORedis;

  constructor(
    private prisma: PrismaClient,
    private documentService: DocumentService,
    private embeddingService: EmbeddingService
  ) {
    // Redis connection with production settings
    this.redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    });

    this.indexingQueue = new Queue('ai-indexing', {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.scheduler = new QueueScheduler('ai-indexing', {
      connection: this.redis,
    });

    this.setupWorker();
  }

  private setupWorker() {
    this.worker = new Worker(
      'ai-indexing',
      async (job) => {
        return this.processIndexingJob(job);
      },
      {
        connection: this.redis,
        concurrency: 5, // Limit concurrent indexing jobs
        limiter: {
          max: 10,
          duration: 60000, // 10 jobs per minute per seller
        },
      }
    );

    this.worker.on('completed', (job, result) => {
      console.log(`Indexing job ${job.id} completed:`, result);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`Indexing job ${job.id} failed:`, err);
    });
  }

  async enqueueIndexingJob(data: IndexingJobData, options: { delay?: number; priority?: number } = {}) {
    const job = await this.indexingQueue.add(
      'index-document',
      data,
      {
        delay: options.delay,
        priority: options.priority || 0,
        // Deduplicate jobs for same seller and source
        jobId: `${data.sellerId}-${data.jobType}-${data.sourceType || 'all'}-${data.sourceId || 'all'}`,
      }
    );

    return job;
  }

  async enqueueFullReindex(sellerId: string, priority: number = 0) {
    return this.enqueueIndexingJob({
      sellerId,
      jobType: 'FULL_REINDEX',
    }, { priority });
  }

  async enqueueDocumentUpsert(sellerId: string, sourceType: string, sourceId: string) {
    return this.enqueueIndexingJob({
      sellerId,
      jobType: 'UPSERT_DOCUMENT',
      sourceType,
      sourceId,
    }, { priority: 10 }); // Higher priority for updates
  }

  async enqueueDocumentDelete(sellerId: string, sourceType: string, sourceId: string) {
    return this.enqueueIndexingJob({
      sellerId,
      jobType: 'DELETE_DOCUMENT',
      sourceType,
      sourceId,
    }, { priority: 20 }); // Highest priority for deletions
  }

  private async processIndexingJob(job: any): Promise<IndexingJobResult> {
    const startTime = Date.now();
    const data = job.data as IndexingJobData;
    const result: IndexingJobResult = {
      success: false,
      processed: 0,
      errors: [],
      duration: 0,
    };

    try {
      // Update job status in database
      await this.updateJobStatus(job.id, 'RUNNING');

      switch (data.jobType) {
        case 'FULL_REINDEX':
          await this.performFullReindex(data.sellerId, result);
          break;
        case 'UPSERT_DOCUMENT':
          await this.performDocumentUpsert(data.sellerId, data.sourceType!, data.sourceId!, result);
          break;
        case 'DELETE_DOCUMENT':
          await this.performDocumentDelete(data.sellerId, data.sourceType!, data.sourceId!, result);
          break;
        default:
          throw new Error(`Unknown job type: ${data.jobType}`);
      }

      result.success = true;
      await this.updateJobStatus(job.id, 'SUCCEEDED');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMessage);
      await this.updateJobStatus(job.id, 'FAILED', errorMessage);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  private async performFullReindex(sellerId: string, result: IndexingJobResult) {
    // Index products
    await this.indexProducts(sellerId, result);
    
    // Add other content types here
    // await this.indexPolicies(sellerId, result);
    // await this.indexFAQs(sellerId, result);
  }

  private async indexProducts(sellerId: string, result: IndexingJobResult) {
    // Get all products for the seller
    const products = await this.prisma.$queryRaw`
      SELECT id, name, description, category, brand, sku, price, currency, updated_at
      FROM products 
      WHERE seller_id = ${sellerId}
    `;

    for (const product of products as any[]) {
      try {
        // Check if document already exists and is up-to-date
        const existingDocument = await this.prisma.aiDocument.findFirst({
          where: {
            sellerId,
            sourceType: 'PRODUCT',
            sourceId: product.id,
          },
        });

        const currentChecksum = this.generateProductChecksum(product);
        
        if (existingDocument && existingDocument.checksum === currentChecksum) {
          // Skip if unchanged
          continue;
        }

        // Create AI document from product
        const document = await this.documentService.createDocumentFromSource(
          sellerId,
          { type: 'PRODUCT', data: product },
          'PRODUCT'
        );

        // Create chunks
        const chunks = await this.documentService.chunkDocument(document.id);
        
        // Generate and store embeddings
        await this.embeddingService.storeEmbeddings(document.id, sellerId, chunks);
        
        result.processed++;
      } catch (error) {
        const errorMessage = `Failed to index product ${product.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMessage);
      }
    }
  }

  private async performDocumentUpsert(
    sellerId: string,
    sourceType: string,
    sourceId: string,
    result: IndexingJobResult
  ) {
    // Handle different source types
    switch (sourceType) {
      case 'PRODUCT':
        await this.upsertProductDocument(sellerId, sourceId, result);
        break;
      default:
        throw new Error(`Unsupported source type: ${sourceType}`);
    }
  }

  private async upsertProductDocument(sellerId: string, productId: string, result: IndexingJobResult) {
    const product = await this.prisma.$queryRaw`
      SELECT id, name, description, category, brand, sku, price, currency, updated_at
      FROM products 
      WHERE seller_id = ${sellerId} AND id = ${productId}
    `;

    if (!product || (product as any[]).length === 0) {
      throw new Error(`Product ${productId} not found`);
    }

    const productData = (product as any[])[0];
    
    // Check if document already exists and is up-to-date
    const existingDocument = await this.prisma.aiDocument.findFirst({
      where: {
        sellerId,
        sourceType: 'PRODUCT',
        sourceId: productId,
      },
    });

    const currentChecksum = this.generateProductChecksum(productData);
    
    if (existingDocument && existingDocument.checksum === currentChecksum) {
      // Skip if unchanged
      return;
    }

    // Create or update AI document
    const document = await this.documentService.createDocumentFromSource(
      sellerId,
      { type: 'PRODUCT', data: productData },
      'PRODUCT'
    );

    // Delete existing chunks if updating
    if (existingDocument) {
      await this.embeddingService.deleteDocumentEmbeddings(document.id);
    }

    // Create chunks
    const chunks = await this.documentService.chunkDocument(document.id);
    
    // Generate and store embeddings
    await this.embeddingService.storeEmbeddings(document.id, sellerId, chunks);
    
    result.processed++;
  }

  private async performDocumentDelete(
    sellerId: string,
    sourceType: string,
    sourceId: string,
    result: IndexingJobResult
  ) {
    // Find and delete the document
    const document = await this.prisma.aiDocument.findFirst({
      where: {
        sellerId,
        sourceType,
        sourceId,
      },
    });

    if (document) {
      await this.documentService.deleteDocument(document.id);
      result.processed++;
    }
  }

  private generateProductChecksum(product: any): string {
    const crypto = require('crypto');
    const dataString = JSON.stringify({
      name: product.name,
      description: product.description,
      category: product.category,
      brand: product.brand,
      sku: product.sku,
      price: product.price,
      currency: product.currency,
      updated_at: product.updated_at,
    });
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }

  private async updateJobStatus(jobId: string, status: string, error?: string) {
    // Update job status in database (if you have job tracking table)
    // This would be the AiIndexJob table from your schema
    try {
      await this.prisma.aiIndexJob.updateMany({
        where: { id: jobId },
        data: {
          status,
          lastError: error,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      // Log error but don't fail the job
      console.error('Failed to update job status:', err);
    }
  }

  async getQueueStatus() {
    const waiting = await this.indexingQueue.getWaiting();
    const active = await this.indexingQueue.getActive();
    const completed = await this.indexingQueue.getCompleted();
    const failed = await this.indexingQueue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }

  async pauseQueue() {
    await this.indexingQueue.pause();
  }

  async resumeQueue() {
    await this.indexingQueue.resume();
  }

  async close() {
    await this.worker.close();
    await this.scheduler.close();
    await this.indexingQueue.close();
    await this.redis.disconnect();
  }
}
