import { getKv, HEALTH_KEY } from '@/lib/kv/client'

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
    const kv = await getKv()
    await kv.put(HEALTH_KEY, String(Date.now()))
    const value = await kv.get(HEALTH_KEY)
    if (!value) {
      return {
        status: 'unhealthy',
        error: 'KV health key was not readable after write',
      }
    }
    return {
      status: 'healthy',
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      error:
        error instanceof Error ? error.message : 'Database connection failed',
    }
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

    const services: HealthCheckStatus['services'] = {
      database: databaseStatus,
    }

    const isHealthy = databaseStatus.status === 'healthy'

    const healthStatus: HealthCheckStatus = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      services,
    }

    return createHealthResponse(healthStatus, isHealthy)
  } catch (error) {
    const errorStatus: HealthCheckStatus = {
      status: 'unhealthy',
      services: {
        database: {
          status: 'unhealthy',
          error:
            error instanceof Error ? error.message : 'Readiness check failed',
        },
      },
    }

    return createHealthResponse(errorStatus, false)
  }
}

export async function checkLiveness(): Promise<Response> {
  try {
    const healthStatus: HealthCheckStatus = {
      status: 'healthy',
    }

    return createHealthResponse(healthStatus, true)
  } catch {
    const errorStatus: HealthCheckStatus = {
      status: 'unhealthy',
    }

    return createHealthResponse(errorStatus, false)
  }
}
