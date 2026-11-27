export const promotionStart = Date.parse('2026-11-27T08:30:00+02:00')
export const promotionEnd = Date.parse('2026-11-28T08:30:00+02:00')

export function promotionRemaining(now) {
  const time = now.getTime()
  return time >= promotionStart && time < promotionEnd
    ? Math.ceil((promotionEnd - time) / 1000)
    : 0
}

function harareDay(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Harare',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => Number(parts.find((item) => item.type === type).value)
  return Math.floor(Date.UTC(part('year'), part('month') - 1, part('day')) / 86400000)
}

export function tasksAllowed(now, signupAt) {
  const currentDay = harareDay(now)
  const dayOfWeek = (currentDay + 4) % 7
  if (dayOfWeek !== 0 && dayOfWeek !== 6) return true
  if (!signupAt) return false
  const signup = new Date(signupAt)
  if (Number.isNaN(signup.getTime()) || signup > now) return false
  const signupDay = harareDay(signup)
  const signupWeekday = (signupDay + 4) % 7
  return [5, 6, 0].includes(signupWeekday)
    && currentDay - signupDay >= 0
    && currentDay - signupDay <= (signupWeekday === 5 ? 2 : signupWeekday === 6 ? 1 : 0)
}
