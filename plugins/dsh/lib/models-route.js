/**
 * Exact Fetch route for the VibeStack model-layer settings page.
 *
 * GET  /api/vibestack/models  -> {ok, layers, default, warnings, catalog?}
 * POST /api/vibestack/models  -> validate, atomically write, reload
 *
 * The route never exposes the config path or credentials; the service owns
 * both reads and writes.
 */

import { saveModels } from './service.js'

/** Route path under Connection's `/api` prefix. */
export const MODELS_PATH = '/api/vibestack/models'

/**
 * Build the exact Fetch route.
 * @param {{service: import('./service.js').VibeStackService}} options - wiring.
 * @returns {{path: string, methods: string[], requestBody: 'buffered', fetch: (request: Request) => Promise<Response>}} route.
 */
export function createModelsRoute(options) {
  const { service } = options
  return {
    path: MODELS_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        if (request.method === 'GET') {
          const snapshot = await service.reload()
          const catalog = await service.catalog(request.signal)
          return json({ ok: true, ...snapshot, catalog })
        }
        let body
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, code: 'invalid-json', message: 'request body must be JSON' }, 400)
        }
        const result = await saveModels(service, body)
        return json(result, result.ok ? 200 : 400)
      } catch (error) {
        return json(
          { ok: false, code: 'models-route-failed', message: String(error?.message ?? error) },
          500,
        )
      }
    },
  }
}

/**
 * JSON response with no caching.
 * @param {unknown} value - body.
 * @param {number} [status] - status code.
 * @returns {Response} response.
 */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
