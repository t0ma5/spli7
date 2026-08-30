import { getD1 } from '@/lib/db/client'

export interface HealthCheckStatus {
  status: 'healthy' | 'unhealthy'
  services?: {
    database?: {
      status: 'healthy' | 'unhealthy'
      error?: string
    }
  }
}

async function checkDatabase(): Promise<{
  status: 'healthy' | 'unhealthy'
  error?: string
}> {
  try {
    const db = await getD1()
    const row = await db.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    if (!row || row.ok !== 1) {
      return { status: 'unhealthy', error: 'Database probe failed' }
    }
    return { status: 'healthy' }
  } catch {
    return { status: 'unhealthy', error: 'Database connection failed' }
  }
}

function createHealthResponse(
  data: HealthCheckStatus,
  isHealthy: boolean,
): Response {
  return new Response(JSON.stringify(data), {
    status: isHealthy ? 200 : 503,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Type': 'application/json',
    },
  })
}

export async function checkReadiness(): Promise<Response> {
  try {
    const databaseStatus = await checkDatabase()
    const isHealthy = databaseStatus.status === 'healthy'
    return createHealthResponse(
      {
        status: isHealthy ? 'healthy' : 'unhealthy',
        services: { database: { status: databaseStatus.status } },
      },
      isHealthy,
    )
  } catch {
    return createHealthResponse(
      {
        status: 'unhealthy',
        services: { database: { status: 'unhealthy' } },
      },
      false,
    )
  }
}

export async function checkLiveness(): Promise<Response> {
  return createHealthResponse({ status: 'healthy' }, true)
}
