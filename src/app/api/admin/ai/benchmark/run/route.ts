import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { AiPolicyService } from '@/server/modules/ai/policy.service';
import { RetrievalService } from '@/server/modules/ai/retrieval.service';
import { EmbeddingService } from '@/server/modules/ai/embedding.service';

const prisma = new PrismaClient();
const policyService = new AiPolicyService(prisma);
const embeddingService = new EmbeddingService(prisma);
const retrievalService = new RetrievalService(prisma, embeddingService);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sellerId, suite = 'DEFAULT' } = body;

    if (!sellerId) {
      return NextResponse.json(
        { error: 'Seller ID is required' },
        { status: 400 }
      );
    }

    // Check if AI is enabled for this seller
    const isRetrievalEnabled = await policyService.isFeatureEnabled(sellerId, 'retrieval');
    if (!isRetrievalEnabled) {
      return NextResponse.json(
        { error: 'AI retrieval is not enabled for this seller' },
        { status: 403 }
      );
    }

    // Create benchmark run
    const benchmarkRun = await prisma.aiBenchmarkRun.create({
      data: {
        sellerId,
        suite,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // Run benchmark asynchronously
    runBenchmark(benchmarkRun.id).catch(console.error);

    return NextResponse.json({
      runId: benchmarkRun.id,
      status: 'RUNNING',
      message: 'Benchmark run started',
    });
  } catch (error) {
    console.error('Failed to start benchmark:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function runBenchmark(runId: string) {
  try {
    const run = await prisma.aiBenchmarkRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      throw new Error('Benchmark run not found');
    }

    // Get benchmark cases for this seller and suite
    const cases = await prisma.aiBenchmarkCase.findMany({
      where: {
        sellerId: run.sellerId,
        suite: run.suite,
      },
    });

    if (cases.length === 0) {
      // Create default benchmark cases if none exist
      await createDefaultBenchmarkCases(run.sellerId, run.suite);
    }

    // Run the benchmark
    const results = await executeBenchmark(run.sellerId, run.suite);

    // Update run with results
    await prisma.aiBenchmarkRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultsJson: JSON.stringify(results),
      },
    });

    // Update seller's benchmark gate status based on results
    const passed = results.overallScore >= 0.8; // 80% threshold
    await policyService.setBenchmarkGatePassed(run.sellerId, passed);

  } catch (error) {
    console.error(`Benchmark run ${runId} failed:`, error);
    
    await prisma.aiBenchmarkRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

async function createDefaultBenchmarkCases(sellerId: string, suite: string) {
  const defaultCases = [
    {
      sellerId,
      suite,
      queryText: 'product information',
      expectedSourceType: 'PRODUCT',
      languageCode: 'en',
    },
    {
      sellerId,
      suite,
      queryText: 'order status',
      expectedSourceType: 'SUPPORT',
      languageCode: 'en',
    },
    {
      sellerId,
      suite,
      queryText: 'pricing',
      expectedSourceType: 'PRODUCT',
      languageCode: 'en',
    },
    {
      sellerId,
      suite,
      queryText: 'delivery information',
      expectedSourceType: 'SUPPORT',
      languageCode: 'en',
    },
    {
      sellerId,
      suite,
      queryText: 'returns',
      expectedSourceType: 'SUPPORT',
      languageCode: 'en',
    },
  ];

  await prisma.aiBenchmarkCase.createMany({
    data: defaultCases,
  });
}

async function executeBenchmark(sellerId: string, suite: string) {
  const cases = await prisma.aiBenchmarkCase.findMany({
    where: { sellerId, suite },
  });

  let totalScore = 0;
  const results = [];

  for (const testCase of cases) {
    const startTime = Date.now();
    
    try {
      const { results: searchResults } = await retrievalService.search(sellerId, {
        query: testCase.queryText,
        topK: 5,
        includeRerank: true,
      });

      const latency = Date.now() - startTime;
      
      // Calculate score based on:
      // 1. Expected source type match (40%)
      // 2. Latency under 300ms (30%)
      // 3. Result count (30%)
      
      let score = 0;
      
      // Source type match
      const hasExpectedType = searchResults.some(result => 
        result.sourceType === testCase.expectedSourceType
      );
      if (hasExpectedType) score += 0.4;
      
      // Latency score
      if (latency < 100) score += 0.3;
      else if (latency < 300) score += 0.2;
      else if (latency < 500) score += 0.1;
      
      // Result count score
      if (searchResults.length >= 3) score += 0.3;
      else if (searchResults.length >= 1) score += 0.2;
      else if (searchResults.length >= 0.5) score += 0.1;

      totalScore += score;
      
      results.push({
        caseId: testCase.id,
        queryText: testCase.queryText,
        expectedSourceType: testCase.expectedSourceType,
        actualResults: searchResults.length,
        latency,
        score,
        passed: score >= 0.6,
      });
      
    } catch (error) {
      results.push({
        caseId: testCase.id,
        queryText: testCase.queryText,
        expectedSourceType: testCase.expectedSourceType,
        error: error instanceof Error ? error.message : 'Unknown error',
        score: 0,
        passed: false,
      });
    }
  }

  const overallScore = totalScore / cases.length;
  
  return {
    suite,
    totalCases: cases.length,
    overallScore,
    passed: overallScore >= 0.8,
    results,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sellerId = searchParams.get('sellerId');

    if (!sellerId) {
      return NextResponse.json(
        { error: 'Seller ID is required' },
        { status: 400 }
      );
    }

    // Get recent benchmark runs
    const runs = await prisma.aiBenchmarkRun.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        suite: true,
        status: true,
        startedAt: true,
        completedAt: true,
        resultsJson: true,
        error: true,
      },
    });

    return NextResponse.json({
      sellerId,
      runs: runs.map(run => ({
        ...run,
        results: run.resultsJson ? JSON.parse(run.resultsJson) : null,
      })),
    });
  } catch (error) {
    console.error('Failed to get benchmark runs:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
