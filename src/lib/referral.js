export function getReferralCodeFromUrl(url) {
  const parsedUrl = new URL(url)
  const queryCode = parsedUrl.searchParams.get('ref')
  const pathCode = parsedUrl.pathname.split('/').filter(Boolean)[0]
  return (queryCode || pathCode || '').trim().toUpperCase()
}

export function getReferralUrl(origin, referralCode) {
  const url = new URL('/', origin)
  url.searchParams.set('ref', referralCode)
  return url.toString()
}
