import test from 'node:test'
import assert from 'node:assert/strict'
import { getReferralCodeFromUrl, getReferralUrl } from '../src/lib/referral.js'

test('referral links contain the complete site URL and prefill the code', () => {
  const url = getReferralUrl('https://reapnow.online', 'ABC123')
  assert.equal(url, 'https://reapnow.online/?ref=ABC123')
  assert.equal(getReferralCodeFromUrl(url), 'ABC123')
})

test('old referral links remain supported and query codes take precedence', () => {
  assert.equal(getReferralCodeFromUrl('https://reapnow.netlify.app/abc123'), 'ABC123')
  assert.equal(getReferralCodeFromUrl('https://reapnow.online/old?ref=new'), 'NEW')
  assert.equal(getReferralCodeFromUrl('https://reapnow.online/'), '')
})
