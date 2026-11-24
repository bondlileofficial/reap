import { createClient } from '@supabase/supabase-js'

const tables = new Set(['deposit_requests', 'withdrawal_requests'])

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function isValidEvent(event) {
  return event
    && event.schema === 'public'
    && tables.has(event.table)
    && ['INSERT', 'UPDATE', 'UPSERT'].includes(event.type)
    && event.record
    && typeof event.record.id === 'string'
    && typeof event.record.user_id === 'string'
}

export async function handler(request) {
  if (request.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' })
  }

  const syncSecret = process.env.TRANSACTION_SYNC_SECRET
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL
  if (!syncSecret || !scriptUrl) {
    console.error('Transaction sync is not configured.')
    return jsonResponse(503, { error: 'Transaction sync is not configured.' })
  }

  let payload
  try {
    payload = JSON.parse(request.body || '')
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON payload.' })
  }

  let event
  const headers = request.headers || {}
  const suppliedSecret = headers['x-sync-secret'] || headers['X-Sync-Secret']
  if (suppliedSecret) {
    if (suppliedSecret !== syncSecret) return jsonResponse(401, { error: 'Unauthorized.' })
    event = payload
  } else {
    const authorization = headers.authorization || headers.Authorization || ''
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!accessToken) return jsonResponse(401, { error: 'Authentication required.' })

    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase public environment values are not configured for the sync function.')
      return jsonResponse(503, { error: 'Transaction sync is not configured.' })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken)
    if (authError || !user) return jsonResponse(401, { error: 'Invalid session.' })

    const table = payload?.table
    const id = payload?.id
    if (!tables.has(table) || typeof id !== 'string') {
      return jsonResponse(400, { error: 'Invalid transaction request.' })
    }

    const { data: record, error: recordError } = await supabase
      .from(table)
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    if (recordError || !record) return jsonResponse(404, { error: 'Transaction was not found.' })

    event = { type: 'UPSERT', schema: 'public', table, record }
  }

  if (!isValidEvent(event)) return jsonResponse(400, { error: 'Invalid transaction event.' })

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: syncSecret, ...event }),
      redirect: 'follow',
    })
    if (!response.ok) {
      console.error(`Google Sheets endpoint returned HTTP ${response.status}.`)
      return jsonResponse(502, { error: 'Google Sheets sync failed.' })
    }

    const result = await response.json()
    if (result?.ok !== true) {
      console.error('Google Sheets endpoint rejected a transaction event.')
      return jsonResponse(502, { error: 'Google Sheets sync failed.' })
    }

    return jsonResponse(200, { ok: true })
  } catch (error) {
    console.error('Could not forward transaction to Google Sheets.', error)
    return jsonResponse(502, { error: 'Google Sheets sync failed.' })
  }
}
