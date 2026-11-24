const SPREADSHEET_ID = '1-oCfaynLalMNa5cR4ORjWUTfnO97GpvgiMR4T3yTs_g'

const TABLE_CONFIG = {
  deposit_requests: {
    sheetName: 'Deposits',
    headers: [
      'request_id',
      'created_at',
      'user_id',
      'amount_usd',
      'asset',
      'network',
      'status',
      'transaction_id',
    ],
  },
  withdrawal_requests: {
    sheetName: 'Withdrawals',
    headers: [
      'request_id',
      'created_at',
      'user_id',
      'amount_usd',
      'fee_usd',
      'payout_usd',
      'asset',
      'network',
      'destination_address',
      'status',
      'transaction_id',
    ],
  },
}

function doPost(request) {
  try {
    const payload = JSON.parse(request.postData.contents)
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET')
    if (!matchesSecret(payload.secret, expectedSecret)) {
      return jsonOutput({ ok: false, error: 'Unauthorized' })
    }

    const config = TABLE_CONFIG[payload.table]
    const record = payload.record
    if (!config || !record || typeof record.id !== 'string') {
      return jsonOutput({ ok: false, error: 'Invalid transaction event' })
    }

    const lock = LockService.getScriptLock()
    lock.waitLock(10000)
    try {
      const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID)
      const sheet = spreadsheet.getSheetByName(config.sheetName) || spreadsheet.insertSheet(config.sheetName)
      ensureHeaders(sheet, config.headers)
      upsertRecord(sheet, config.headers, record)
    } finally {
      lock.releaseLock()
    }

    return jsonOutput({ ok: true })
  } catch (error) {
    console.error(error)
    return jsonOutput({ ok: false, error: 'Could not save transaction' })
  }
}

function matchesSecret(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || supplied.length !== expected.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < supplied.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

function ensureHeaders(sheet, headers) {
  const existing = sheet.getLastRow()
    ? sheet.getRange(1, 1, 1, headers.length).getValues()[0]
    : []
  if (existing.length && existing.some((value, index) => value !== headers[index])) {
    throw new Error(`The ${sheet.getName()} sheet has an unexpected header row.`)
  }
  if (!existing.length) sheet.getRange(1, 1, 1, headers.length).setValues([headers])
}

function upsertRecord(sheet, headers, record) {
  const lastRow = sheet.getLastRow()
  const ids = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat() : []
  const existingIndex = ids.findIndex((id) => id === record.id)
  const row = headers.map((header) => {
    if (header === 'request_id') return record.id
    if (header === 'transaction_id') return record.provider_reference || ''
    return record[header] ?? ''
  })

  if (existingIndex >= 0) {
    sheet.getRange(existingIndex + 2, 1, 1, headers.length).setValues([row])
  } else {
    sheet.appendRow(row)
  }
}

function jsonOutput(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON)
}
