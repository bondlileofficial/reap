import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { getReferralCodeFromUrl, getReferralUrl } from './lib/referral'
import './App.css'

const tronDepositAddress = 'TL2Lv1QKRgswFNLJ9km6HzHMr8WaSsH3ij'
const authSessionStartedKey = 'reap.auth-session-started-at'
const siteClosedAtKey = 'reap.site-closed-at'
const maximumSessionAgeMs = 5 * 60 * 1000
const closedSiteGraceMs = 10 * 1000
const localTaskVideoUrls = [
  '/task%20videos/Blue%20Sky%20Sunset%20Quote%20Video%20.mp4',
  '/task%20videos/Brown%20and%20White%20Simple%20Nature%20Video.mp4',
  '/task%20videos/Orange%20and%20Black%20Illustrated%20Sunset%20Movie%20Credit%20Title%20Video.mp4',
]

function getUtcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function getKampalaTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kampala',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const getPart = (type) => parts.find((part) => part.type === type)?.value
  return {
    weekday: getPart('weekday'),
    hour: Number(getPart('hour')),
    minute: Number(getPart('minute')),
  }
}

function formatUtcDate(dateKey) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T00:00:00.000Z`))
}

const plans = [
  { amount: 5, daily: 0.85, tasks: 3, accent: '#d9efaf' },
  { amount: 10, daily: 1, tasks: 4, accent: '#ffd7a5' },
  { amount: 15, daily: 2, tasks: 5, accent: '#cbd9ff', popular: true },
  { amount: 30, daily: 5.5, tasks: 6, accent: '#d9b9ff' },
  { amount: 50, daily: 8, tasks: 7, accent: '#bde4d1' },
  { amount: 80, daily: 12, tasks: 8, accent: '#f1b9c8' },
  { amount: 100, daily: 15, tasks: 9, accent: '#f5dda6' },
  { amount: 120, daily: 18, tasks: 10, accent: '#b6dcd8' },
  { amount: 200, daily: 30, tasks: 12, accent: '#c8caff' },
  { amount: 250, daily: 38, tasks: 15, accent: '#b9dfbd' },
]

function AuthScreen({ message }) {
  const [referralCode, setReferralCode] = useState(() => getReferralCodeFromUrl(window.location.href))
  const [mode, setMode] = useState(() => referralCode ? 'sign-up' : 'sign-in')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)

    try {
      const formData = new FormData(event.currentTarget)
      const email = String(formData.get('email')).trim()
      const password = String(formData.get('password'))
      const displayName = String(formData.get('name') || '').trim()
      const submittedReferralCode = String(formData.get('referral_code') || '').trim().toUpperCase()
      if (mode === 'sign-up' && !submittedReferralCode) {
        setError('A referral code is required to create an account.')
        return
      }
      if (mode === 'sign-up') {
        const { data: referralCodeIsValid, error: referralCheckError } = await supabase.rpc(
          'is_valid_referral_code',
          { p_referral_code: submittedReferralCode },
        )
        if (referralCheckError) throw referralCheckError
        if (!referralCodeIsValid) {
          setError('That referral code is not valid. Ask your inviter for their code and try again.')
          return
        }
      }

      const result = mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: window.location.origin,
              data: {
                display_name: displayName,
                referral_code: submittedReferralCode,
              },
            },
          })

      if (result.error) {
        const isDatabaseSignupError = mode === 'sign-up'
          && result.error.message.toLowerCase().includes('database error saving new user')
        setError(isDatabaseSignupError
          ? 'We could not create your account. Check that the referral code is valid and try again. If the problem continues, contact support.'
          : result.error.message)
      } else if (mode === 'sign-up' && !result.data.session) {
        setNotice('Check your email to confirm your account, then sign in.')
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Authentication request failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><span className="brand-mark"><span /></span><span>reap</span></div>
        <p className="eyebrow">{mode === 'sign-in' ? 'Welcome back' : 'Get started'}</p>
        <h1>{mode === 'sign-in' ? 'Sign in to Reap' : 'Create your account'}</h1>
        {message && <p className="auth-error" role="alert">{message}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <form onSubmit={handleSubmit}>
          {mode === 'sign-up' && (
            <label>Name<input name="name" type="text" autoComplete="name" maxLength="80" required /></label>
          )}
          {mode === 'sign-up' && (
            <label>Referral code (required)
              <input
                name="referral_code"
                type="text"
                autoComplete="off"
                maxLength="12"
                value={referralCode}
                onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                required
              />
            </label>
          )}
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength="8" required /></label>
          <button className="primary-button wide" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(''); setNotice('') }}>
          {mode === 'sign-in' ? 'New to Reap? Create an account' : 'Already registered? Sign in'}
        </button>
      </section>
    </main>
  )
}

const Icon = ({ name, size = 20 }) => {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.9Z"/></>,
    wallet: <><path d="M4 7.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h11"/><path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z"/></>,
    package: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 8 9 5 9-5v9l-9 5-9-5V8Z"/><path d="M12 13v9"/></>,
    activity: <><path d="M3 12h4l2-5 4 10 2-5h6"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    support: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 4.1 2.3c-1.6 1-1.6 1.7-1.6 2.7"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    down: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    up: <><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function App() {
  const [active, setActive] = useState('Overview')
  const [today, setToday] = useState(getUtcDateKey)
  const [scheduleNow, setScheduleNow] = useState(() => new Date())
  const [modal, setModal] = useState(null)
  const [watchTask, setWatchTask] = useState(null)
  const [watchedSeconds, setWatchedSeconds] = useState(0)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [watchBusy, setWatchBusy] = useState(false)
  const [watchCompleted, setWatchCompleted] = useState(false)
  const [watchError, setWatchError] = useState('')
  const videoElement = useRef(null)
  const taskCompletionInProgress = useRef(false)
  const [depositNetwork, setDepositNetwork] = useState('TRC20')
  const [addressCopied, setAddressCopied] = useState(false)
  const [depositAmount, setDepositAmount] = useState(String(plans[2].amount))
  const [depositProofFile, setDepositProofFile] = useState(null)
  const depositProofInput = useRef(null)
  const [depositBusy, setDepositBusy] = useState(false)
  const [depositNotice, setDepositNotice] = useState('')
  const [depositError, setDepositError] = useState('')
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
  const [withdrawalNetwork, setWithdrawalNetwork] = useState('TRC20')
  const [withdrawalAddress, setWithdrawalAddress] = useState('')
  const [withdrawalRequests, setWithdrawalRequests] = useState([])
  const [withdrawalBusy, setWithdrawalBusy] = useState(false)
  const [withdrawalBalanceLoading, setWithdrawalBalanceLoading] = useState(false)
  const [withdrawalError, setWithdrawalError] = useState('')
  const [withdrawalNotice, setWithdrawalNotice] = useState('')
  const [packagePurchaseBusy, setPackagePurchaseBusy] = useState(false)
  const [packageBalanceLoading, setPackageBalanceLoading] = useState(false)
  const [packagePurchaseError, setPackagePurchaseError] = useState('')
  const [packagePurchaseNotice, setPackagePurchaseNotice] = useState('')
  const [dbPlans, setDbPlans] = useState(plans)
  const [selectedPlan, setSelectedPlan] = useState(plans[2])
  const [tasks, setTasks] = useState([])
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [depositRequests, setDepositRequests] = useState([])
  const [databaseAvailableBalance, setDatabaseAvailableBalance] = useState(null)
  const [packages, setPackages] = useState([])
  const [taskCompletions, setTaskCompletions] = useState([])
  const [taskProgress, setTaskProgress] = useState({
    cycle_id: null,
    resets_at: null,
    task_limit: 0,
    completed_count: 0,
  })
  const [taskClockNow, setTaskClockNow] = useState(0)
  const [profile, setProfile] = useState(null)
  const [profileName, setProfileName] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  const [transactionReviewerId, setTransactionReviewerId] = useState(null)
  const [reviewRoleCheckedUserId, setReviewRoleCheckedUserId] = useState(null)
  const [reviewQueue, setReviewQueue] = useState([])
  const [reviewQueueUserId, setReviewQueueUserId] = useState(null)
  const [reviewProofUrls, setReviewProofUrls] = useState({})
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewBusyKey, setReviewBusyKey] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [reviewNotice, setReviewNotice] = useState('')
  const [dataLoading, setDataLoading] = useState(isSupabaseConfigured)
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState('')
  const [appError, setAppError] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [referralSummary, setReferralSummary] = useState(null)
  const [referralError, setReferralError] = useState('')
  const [referralUserId, setReferralUserId] = useState(null)
  const [referralCopied, setReferralCopied] = useState(false)
  const referralLoading = Boolean(session?.user.id && referralUserId !== session.user.id)
  const siteTime = getKampalaTimeParts(scheduleNow)
  const isTaskWeekday = !['Sat', 'Sun'].includes(siteTime.weekday)
  const isWithdrawalWindowOpen = siteTime.hour >= 9 && siteTime.hour < 16
  const userId = session?.user.id
  const canReviewTransactions = Boolean(userId && reviewRoleCheckedUserId === userId && transactionReviewerId === userId)
  const visibleReviewQueue = reviewQueueUserId === userId ? reviewQueue : []

  useEffect(() => {
    if (!watchTask || !videoPlaying || watchCompleted) return undefined

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setWatchedSeconds((seconds) => Math.min(30, seconds + 1))
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [watchTask, videoPlaying, watchCompleted])

  useEffect(() => {
    let timer
    const initialTimer = window.setTimeout(updateToday, 0)

    function updateToday() {
      if (timer) window.clearTimeout(timer)

      const now = new Date()
      setToday(getUtcDateKey(now))
      const nextUtcMidnight = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      )
      timer = window.setTimeout(updateToday, nextUtcMidnight - now.getTime() + 50)
    }

    function updateWhenVisible() {
      if (document.visibilityState === 'visible') updateToday()
    }

    document.addEventListener('visibilitychange', updateWhenVisible)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', updateWhenVisible)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setScheduleNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const openModal = (type) => {
    if (type === 'deposit') {
      setDepositNetwork('TRC20')
      setAddressCopied(false)
      setDepositAmount(String(selectedPlan.amount))
      setDepositProofFile(null)
      if (depositProofInput.current) depositProofInput.current.value = ''
      setDepositBusy(false)
      setDepositNotice('')
      setDepositError('')
    }
    if (type === 'withdraw') {
      setWithdrawalAmount('')
      setWithdrawalNetwork('TRC20')
      setWithdrawalAddress('')
      setWithdrawalError('')
      setWithdrawalNotice('')
      setWithdrawalBalanceLoading(true)
      refreshWalletRecords()
        .catch((requestError) => {
          setWithdrawalError(requestError instanceof Error ? requestError.message : 'Could not verify your available balance.')
        })
        .finally(() => setWithdrawalBalanceLoading(false))
    }
    if (type === 'choose') {
      setPackagePurchaseError('')
      setPackagePurchaseNotice('')
      setPackageBalanceLoading(true)
      refreshWalletRecords()
        .catch((requestError) => {
          setPackagePurchaseError(requestError instanceof Error ? requestError.message : 'Could not verify your wallet balance.')
        })
        .finally(() => setPackageBalanceLoading(false))
    }
    setModal(type)
  }

  async function handleSignOut() {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) setAppError(error.message)
    } catch (requestError) {
      setAppError(requestError instanceof Error ? requestError.message : 'Sign out failed.')
    }
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (!session?.user.id) {
      setProfileError('Sign in to update your account details.')
      return
    }

    const displayName = profileName.trim()
    const phoneNumber = profilePhone.trim()
    if (!displayName) {
      setProfileError('Enter your name before saving.')
      return
    }

    setProfileBusy(true)
    setProfileError('')
    setProfileNotice('')
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ display_name: displayName, phone_number: phoneNumber || null })
        .eq('id', session.user.id)
        .select('id, display_name, phone_number, referral_code')
        .single()

      if (error) throw error
      setProfile(data)
      setProfileName(data.display_name || '')
      setProfilePhone(data.phone_number || '')
      setProfileNotice('Your account details have been saved.')
    } catch (requestError) {
      setProfileError(requestError instanceof Error ? requestError.message : 'Could not save your account details.')
    } finally {
      setProfileBusy(false)
    }
  }

  useEffect(() => {
    if (!supabase) return undefined

    let active = true
    let signOutScheduled = false

    function expireSession(message) {
      try {
        localStorage.removeItem(authSessionStartedKey)
      } catch (storageError) {
        message = `${message} ${storageError instanceof Error ? storageError.message : 'Session storage could not be cleared.'}`
      }
      setSession(null)
      setAuthError(message)
      setAuthLoading(false)
      if (!signOutScheduled) {
        signOutScheduled = true
        window.setTimeout(() => {
          supabase.auth.signOut().catch((signOutError) => {
            setAuthError(signOutError instanceof Error ? signOutError.message : 'Could not end the expired session.')
          })
        }, 0)
      }
    }

    function acceptSession(nextSession, eventName = 'INITIAL_SESSION') {
      if (!active) return

      try {
        if (!nextSession) {
          localStorage.removeItem(authSessionStartedKey)
          setSession(null)
          setAuthError('')
          setAuthLoading(false)
          return
        }

        const now = Date.now()
        const closedAt = Number(localStorage.getItem(siteClosedAtKey))
        if (eventName !== 'SIGNED_IN' && Number.isFinite(closedAt) && closedAt > 0) {
          localStorage.removeItem(siteClosedAtKey)
          if (now - closedAt > closedSiteGraceMs) {
            expireSession('You were signed out because the site was closed for more than 10 seconds.')
            return
          }
        } else if (eventName === 'SIGNED_IN') {
          localStorage.removeItem(siteClosedAtKey)
        }

        let startedAt = Number(localStorage.getItem(authSessionStartedKey))
        if (eventName === 'SIGNED_IN' || !Number.isFinite(startedAt) || startedAt <= 0) {
          startedAt = now
          localStorage.setItem(authSessionStartedKey, String(startedAt))
        }

        if (now - startedAt >= maximumSessionAgeMs) {
          expireSession('Your five-minute session has expired. Please sign in again.')
          return
        }

        setSession(nextSession)
        setAuthError('')
        setAuthLoading(false)
      } catch (storageError) {
        expireSession(storageError instanceof Error ? storageError.message : 'Could not validate your secure session.')
      }
    }

    function markSiteClosed() {
      try {
        if (localStorage.getItem(authSessionStartedKey)) {
          localStorage.setItem(siteClosedAtKey, String(Date.now()))
        }
      } catch (storageError) {
        setAuthError(storageError instanceof Error ? storageError.message : 'Could not record the secure session state.')
      }
    }

    const handlePageShow = () => {
      supabase.auth.getSession().then(({ data, error }) => {
        if (!active) return
        if (error) {
          setAuthError(error.message)
          setAuthLoading(false)
          return
        }
        acceptSession(data.session)
      })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      acceptSession(nextSession, event)
    })

    window.addEventListener('pagehide', markSiteClosed)
    window.addEventListener('pageshow', handlePageShow)

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setAuthError(error.message)
        setAuthLoading(false)
      } else {
        acceptSession(data.session)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
      window.removeEventListener('pagehide', markSiteClosed)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  useEffect(() => {
    if (!session) return undefined

    let signOutPending = false

    function enforceSessionAge() {
      if (signOutPending) return

      try {
        const startedAt = Number(localStorage.getItem(authSessionStartedKey))
        if (!Number.isFinite(startedAt) || startedAt <= 0 || Date.now() - startedAt >= maximumSessionAgeMs) {
          signOutPending = true
          localStorage.removeItem(authSessionStartedKey)
          supabase.auth.signOut().then(({ error }) => {
            if (error) setAuthError(error.message)
          })
        }
      } catch (storageError) {
        signOutPending = true
        setAuthError(storageError instanceof Error ? storageError.message : 'Could not validate your secure session.')
        supabase.auth.signOut().then(({ error }) => {
          if (error) setAuthError(error.message)
        })
      }
    }

    const timer = window.setInterval(enforceSessionAge, 1000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') enforceSessionAge()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [session])

  useEffect(() => {
    if (!session?.user.id) return undefined

    let activeRequest = true

    async function loadReferralData() {
      try {
        const [profileResult, summaryResult] = await Promise.all([
          supabase.from('profiles').select('referral_code').eq('id', session.user.id).single(),
          supabase.rpc('get_my_referral_summary'),
        ])

        if (profileResult.error) throw profileResult.error
        if (summaryResult.error) throw summaryResult.error

        if (activeRequest) {
          setReferralCode(profileResult.data.referral_code)
          setReferralSummary(Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data)
          setReferralError('')
        }
      } catch (requestError) {
        if (activeRequest) {
          setReferralError(requestError instanceof Error ? requestError.message : 'Could not load referral details.')
        }
      } finally {
        if (activeRequest) setReferralUserId(session.user.id)
      }
    }

    loadReferralData()
    return () => { activeRequest = false }
  }, [session?.user.id])

  useEffect(() => {
    if (!supabase) return undefined

    let activeRequest = true

    async function loadDatabaseData() {
      setDataLoading(true)
      setDatabaseAvailableBalance(null)

      const publicQueries = [
        supabase
          .from('plans')
          .select('id, amount_usd, daily_task_limit, daily_reward_usd')
          .eq('active', true)
          .order('amount_usd', { ascending: true }),
        supabase
          .from('tasks')
          .select('id, title, video_url, reward_usd')
          .eq('active', true)
          .in('video_url', localTaskVideoUrls)
          .order('sort_order', { ascending: true })
          .limit(10),
      ]

      try {
        const [plansResult, tasksResult] = await Promise.all(publicQueries)

        if (!activeRequest) return

        if (!plansResult.error && plansResult.data?.length) {
          setDbPlans(plansResult.data.map((plan, index) => ({
            id: plan.id,
            amount: Number(plan.amount_usd),
            daily: Number(plan.daily_reward_usd ?? 0),
            tasks: plan.daily_task_limit,
            accent: plans[index]?.accent ?? '#d9efaf',
            popular: index === 2,
          })))
        } else if (plansResult.error) {
          setAppError(plansResult.error.message)
        }

        if (!tasksResult.error) setTasks(tasksResult.data ?? [])
        else setAppError(tasksResult.error.message)
      } catch (requestError) {
        if (activeRequest) {
          setAppError(requestError instanceof Error ? requestError.message : 'Could not load database records.')
        }
      }

      if (!session?.user.id) {
        if (activeRequest) setDataLoading(false)
        return
      }

      try {
        const [profileResult, ledgerResult, packagesResult, taskProgressResult, withdrawalRequestsResult, walletBalanceResult, depositRequestsResult] = await Promise.all([
          supabase.from('profiles').select('id, display_name, phone_number, referral_code').eq('id', session.user.id).single(),
          supabase.from('ledger_entries').select('entry_type, amount_usd, status, created_at').eq('user_id', session.user.id).eq('status', 'confirmed').order('created_at', { ascending: false }),
          supabase.from('user_packages').select('id, status, starts_at, ends_at, plans(amount_usd, daily_task_limit, daily_reward_usd, active)').eq('user_id', session.user.id).order('created_at', { ascending: false }),
          supabase.rpc('get_my_task_progress'),
          supabase.from('withdrawal_requests').select('id, amount_usd, status').eq('user_id', session.user.id).in('status', ['pending', 'processing']),
          supabase.rpc('get_my_available_wallet_balance'),
          supabase.from('deposit_requests').select('id, amount_usd, status, created_at').eq('user_id', session.user.id).order('created_at', { ascending: false }),
        ])

        if (!activeRequest) return
        let progressRow = null
        let completionsResult = { data: [], error: null }
        if (!taskProgressResult.error) {
          progressRow = Array.isArray(taskProgressResult.data)
            ? taskProgressResult.data[0]
            : taskProgressResult.data
          if (progressRow?.cycle_id) {
            completionsResult = await supabase
              .from('task_completions')
              .select('id, task_id, task_slot, status, completed_on, started_at, completed_at')
              .eq('user_id', session.user.id)
              .eq('task_cycle_id', progressRow.cycle_id)
              .order('task_slot', { ascending: true })
          }
        }
        if (!activeRequest) return

          if (!profileResult.error) {
            setProfile(profileResult.data)
            setProfileName(profileResult.data.display_name || '')
            setProfilePhone(profileResult.data.phone_number || '')
          }
        if (!ledgerResult.error) setLedgerEntries(ledgerResult.data ?? [])
        if (!walletBalanceResult.error && walletBalanceResult.data !== null) {
          setDatabaseAvailableBalance(Number(walletBalanceResult.data))
        } else {
          setDatabaseAvailableBalance(null)
        }
        if (!packagesResult.error) setPackages(packagesResult.data ?? [])
        if (!taskProgressResult.error) {
          setTaskProgress({
            cycle_id: progressRow?.cycle_id ?? null,
            resets_at: progressRow?.resets_at ?? null,
            task_limit: Number(progressRow?.task_limit ?? 0),
            completed_count: Number(progressRow?.completed_count ?? 0),
          })
        }
        if (!completionsResult.error) setTaskCompletions(completionsResult.data ?? [])
        if (!withdrawalRequestsResult.error) setWithdrawalRequests(withdrawalRequestsResult.data ?? [])
        if (!depositRequestsResult.error) setDepositRequests(depositRequestsResult.data ?? [])

        const personalError = [
          profileResult.error,
          ledgerResult.error,
          packagesResult.error,
          taskProgressResult.error,
          completionsResult.error,
          withdrawalRequestsResult.error,
          walletBalanceResult.error,
          depositRequestsResult.error,
        ].find(Boolean)
        if (personalError) setAppError(personalError.message)
      } catch (requestError) {
        if (activeRequest) {
          setAppError(requestError instanceof Error ? requestError.message : 'Could not load account records.')
        }
      } finally {
        if (activeRequest) setDataLoading(false)
      }
    }

    loadDatabaseData()
    return () => { activeRequest = false }
  }, [session?.user.id, today])

  useEffect(() => {
    if (!userId) return undefined
    let activeRequest = true
    supabase.rpc('is_transaction_reviewer').then(({ data, error }) => {
      if (!activeRequest) return
      if (error) {
        setReviewError(`Could not check review access: ${error.message}`)
        setTransactionReviewerId(null)
        setReviewRoleCheckedUserId(userId)
        return
      }
      setTransactionReviewerId(data === true ? userId : null)
      setReviewRoleCheckedUserId(userId)
      setReviewError('')
    }).catch((requestError) => {
      if (activeRequest) {
        setTransactionReviewerId(null)
        setReviewRoleCheckedUserId(userId)
        setReviewError(requestError instanceof Error ? requestError.message : 'Could not check review access.')
      }
    })

    return () => { activeRequest = false }
  }, [userId])

  const refreshWalletRecords = useCallback(async (isActive = () => true) => {
    if (!userId) return

    const [ledgerResult, withdrawalResult, walletBalanceResult, packagesResult, depositRequestsResult] = await Promise.all([
      supabase
        .from('ledger_entries')
        .select('entry_type, amount_usd, status, created_at')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .order('created_at', { ascending: false }),
      supabase
        .from('withdrawal_requests')
        .select('id, amount_usd, status')
        .eq('user_id', userId)
        .in('status', ['pending', 'processing']),
      supabase.rpc('get_my_available_wallet_balance'),
      supabase
        .from('user_packages')
        .select('id, status, starts_at, ends_at, plans(amount_usd, daily_task_limit, daily_reward_usd, active)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('deposit_requests')
        .select('id, amount_usd, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ])
    if (!isActive()) return
    const queryError = ledgerResult.error || withdrawalResult.error || walletBalanceResult.error || packagesResult.error || depositRequestsResult.error
    if (queryError) throw queryError

    setLedgerEntries(ledgerResult.data ?? [])
    setWithdrawalRequests(withdrawalResult.data ?? [])
    setDatabaseAvailableBalance(Number(walletBalanceResult.data))
    setPackages(packagesResult.data ?? [])
    setDepositRequests(depositRequestsResult.data ?? [])
    return Number(walletBalanceResult.data)
  }, [userId])

  const refreshTaskProgress = useCallback(async (isActive = () => true) => {
    if (!userId) return

    const { data, error } = await supabase.rpc('get_my_task_progress')
    if (error) throw error

    const progressRow = Array.isArray(data) ? data[0] : data
    let completions = []
    if (progressRow?.cycle_id) {
      const { data: completionData, error: completionError } = await supabase
        .from('task_completions')
        .select('id, task_id, task_slot, status, completed_on, started_at, completed_at')
        .eq('user_id', userId)
        .eq('task_cycle_id', progressRow.cycle_id)
        .order('task_slot', { ascending: true })
      if (completionError) throw completionError
      completions = completionData ?? []
    }

    if (!isActive()) return
    const nextProgress = {
      cycle_id: progressRow?.cycle_id ?? null,
      resets_at: progressRow?.resets_at ?? null,
      task_limit: Number(progressRow?.task_limit ?? 0),
      completed_count: Number(progressRow?.completed_count ?? 0),
    }
    setTaskProgress(nextProgress)
    setTaskCompletions(completions)
    return nextProgress
  }, [userId])

  useEffect(() => {
    if (!userId) return undefined

    let activeRequest = true
    const timer = window.setInterval(() => {
      refreshWalletRecords(() => activeRequest).catch((requestError) => {
        if (activeRequest) {
          setAppError(requestError instanceof Error ? requestError.message : 'Could not refresh wallet records.')
        }
      })
      refreshTaskProgress(() => activeRequest).catch((requestError) => {
        if (activeRequest) {
          setAppError(requestError instanceof Error ? requestError.message : 'Could not refresh task progress.')
        }
      })
    }, 15000)

    return () => {
      activeRequest = false
      window.clearInterval(timer)
    }
  }, [refreshTaskProgress, refreshWalletRecords, userId])

  useEffect(() => {
    if (!taskProgress.resets_at) return undefined

    const timer = window.setInterval(() => setTaskClockNow(Date.now()), 1000)
    const initialTick = window.setTimeout(() => setTaskClockNow(Date.now()), 0)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(initialTick)
    }
  }, [taskProgress.resets_at])

  useEffect(() => {
    if (!taskProgress.resets_at || new Date(taskProgress.resets_at).getTime() > taskClockNow || !userId) return
    const timer = window.setTimeout(() => {
      refreshTaskProgress().catch((requestError) => {
        setAppError(requestError instanceof Error ? requestError.message : 'Could not renew your task cycle.')
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshTaskProgress, taskClockNow, taskProgress.resets_at, userId])

  const loadReviewQueue = useCallback(async () => {
    if (!canReviewTransactions || !userId) return

    setReviewLoading(true)
    setReviewError('')
    setReviewQueue([])
    setReviewQueueUserId(null)
    setReviewProofUrls({})
    try {
      const { data, error } = await supabase.rpc('get_transaction_review_queue')
      if (error) throw error

      const rows = data ?? []
      const proofUrlResults = await Promise.all(rows
        .filter((request) => request.request_type === 'deposit' && request.proof_path)
        .map(async (request) => {
          const { data: signedUrlData, error: signedUrlError } = await supabase.storage
            .from('deposit-proofs')
            .createSignedUrl(request.proof_path, 120)
          if (signedUrlError) throw signedUrlError
          return [request.id, signedUrlData.signedUrl]
        }))

      setReviewQueue(rows)
      setReviewQueueUserId(userId)
      setReviewProofUrls(Object.fromEntries(proofUrlResults))
    } catch (requestError) {
      setReviewQueue([])
      setReviewQueueUserId(null)
      setReviewProofUrls({})
      setReviewError(requestError instanceof Error ? requestError.message : 'Could not load transaction requests.')
    } finally {
      setReviewLoading(false)
    }
  }, [canReviewTransactions, userId])

  useEffect(() => {
    if (!canReviewTransactions || active !== 'Review') return undefined
    let activeRequest = true
    const timer = window.setTimeout(() => {
      if (activeRequest) loadReviewQueue()
    }, 0)
    return () => {
      activeRequest = false
      window.clearTimeout(timer)
    }
  }, [active, canReviewTransactions, loadReviewQueue])

  async function reviewTransaction(request, decision) {
    const action = `${request.request_type}_${decision}`
    const actionLabels = {
      deposit_approve: `Approve this $${Number(request.amount_usd).toFixed(2)} deposit and credit the user wallet?`,
      deposit_reject: 'Reject this deposit request?',
      withdrawal_approve: `Confirm the $${Number(request.amount_usd).toFixed(2)} withdrawal has already been paid to ${request.destination_address}, then mark it paid and debit the wallet?`,
      withdrawal_reject: 'Reject this withdrawal request and release its reserved balance?',
    }
    if (!window.confirm(actionLabels[action])) return

    setReviewBusyKey(`${request.request_type}:${request.id}`)
    setReviewError('')
    setReviewNotice('')
    try {
      const { error } = await supabase.rpc(`${decision}_${request.request_type}_request`, {
        p_request_id: request.id,
      })
      if (error) throw error

      setReviewNotice(request.request_type === 'deposit'
        ? decision === 'approve' ? 'Deposit approved and credited to the user wallet.' : 'Deposit rejected.'
        : decision === 'approve' ? 'Withdrawal marked paid and debited from the user wallet.' : 'Withdrawal rejected; reserved balance released.')
      await loadReviewQueue()
      try {
        await refreshWalletRecords()
      } catch (refreshError) {
        setAppError(`Decision saved, but the wallet could not be refreshed: ${refreshError instanceof Error ? refreshError.message : 'Unknown error.'}`)
      }
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : 'Could not update this request.')
    } finally {
      setReviewBusyKey('')
    }
  }

  async function copyReferralLink() {
    try {
      await navigator.clipboard.writeText(getReferralUrl(window.location.origin, referralCode))
      setReferralError('')
      setReferralCopied(true)
      window.setTimeout(() => setReferralCopied(false), 2000)
    } catch (copyError) {
      setReferralError(copyError instanceof Error ? copyError.message : 'Could not copy the referral link.')
    }
  }

  async function copyDepositAddress() {
    try {
      await navigator.clipboard.writeText(tronDepositAddress)
      setAddressCopied(true)
      setDepositError('')
      window.setTimeout(() => setAddressCopied(false), 2000)
    } catch (copyError) {
      setDepositError(copyError instanceof Error ? copyError.message : 'Could not copy the deposit address.')
    }
  }

  async function syncTransactionToSheet(table, id) {
    const { data: { session: currentSession }, error } = await supabase.auth.getSession()
    if (error) throw error
    if (!currentSession?.access_token) throw new Error('Your session expired. Sign in again to sync this request.')

    const response = await fetch('/.netlify/functions/sync-transactions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ table, id }),
    })
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw new Error(result.error || 'Transaction was saved, but spreadsheet sync could not be confirmed.')
    }
  }

  async function submitDepositRequest(event) {
    event.preventDefault()
    setDepositError('')
    setDepositNotice('')

    const amount = Number(depositAmount)
    if (!Number.isFinite(amount) || amount < 5) {
      setDepositError('Enter a deposit amount of at least $5.00.')
      return
    }
    if (!depositProofFile) {
      setDepositError('Upload a screenshot of your completed transfer.')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(depositProofFile.type)) {
      setDepositError('Upload a JPG, PNG, or WebP screenshot.')
      return
    }
    if (depositProofFile.size > 5 * 1024 * 1024) {
      setDepositError('The screenshot must be 5 MB or smaller.')
      return
    }
    if (!supabase) {
      setDepositError('Connect Supabase before submitting a deposit request.')
      return
    }

    setDepositBusy(true)
    let uploadedProofPath = ''
    try {
      const fileExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[depositProofFile.type]
      const proofPath = `${session.user.id}/${crypto.randomUUID()}.${fileExtension}`
      const { error: uploadError } = await supabase.storage
        .from('deposit-proofs')
        .upload(proofPath, depositProofFile, { contentType: depositProofFile.type, upsert: false })
      if (uploadError) throw uploadError
      uploadedProofPath = proofPath

      const { data: requestId, error } = await supabase.rpc('request_deposit', {
        p_amount_usd: amount,
        p_network: 'TRC20',
        p_provider_reference: null,
        p_proof_path: proofPath,
      })
      if (error) throw error
      uploadedProofPath = ''

      try {
        await syncTransactionToSheet('deposit_requests', requestId)
      } catch (syncError) {
        console.error('Deposit spreadsheet sync failed after the request was saved.', syncError)
      }
      setDepositNotice('Deposit request successful. Waiting for approval.')
      setDepositProofFile(null)
      if (depositProofInput.current) depositProofInput.current.value = ''
    } catch (requestError) {
      let errorMessage = requestError instanceof Error ? requestError.message : 'Could not submit the deposit request.'
      if (uploadedProofPath) {
        const { error: cleanupError } = await supabase.storage.from('deposit-proofs').remove([uploadedProofPath])
        if (cleanupError) {
          console.error('Could not remove the unlinked deposit proof.', cleanupError)
          errorMessage = `${errorMessage} Your uploaded screenshot could not be removed; contact support before retrying.`
        }
      }
      setDepositError(errorMessage)
    } finally {
      setDepositBusy(false)
    }
  }

  async function submitWithdrawal(event) {
    event.preventDefault()
    setWithdrawalError('')
    setWithdrawalNotice('')
    if (!isWithdrawalWindowOpen) {
      setWithdrawalError('Withdrawals can only be submitted from 9:00 AM to 4:00 PM Africa/Kampala time.')
      return
    }

    const amount = Number(withdrawalAmount)
    if (!Number.isFinite(amount) || amount < 5) {
      setWithdrawalError('Enter a withdrawal amount of at least $5.00.')
      return
    }
    if (!withdrawalAddress.trim()) {
      setWithdrawalError('Enter the wallet address to receive your withdrawal.')
      return
    }
    if (!supabase) {
      setWithdrawalError('Connect Supabase before submitting a withdrawal request.')
      return
    }

    setWithdrawalBusy(true)
    try {
      setWithdrawalBalanceLoading(true)
      const currentAvailableBalance = await refreshWalletRecords()
      if (amount > currentAvailableBalance) {
        setWithdrawalError(`Enter an amount from $5.00 up to your available balance of $${currentAvailableBalance.toFixed(2)}.`)
        return
      }

      const { data, error } = await supabase.rpc('request_withdrawal', {
        p_amount_usd: amount,
        p_network: withdrawalNetwork,
        p_destination_address: withdrawalAddress.trim(),
      })
      if (error) throw error

      setWithdrawalRequests((current) => [
        ...current,
        { id: data, amount_usd: amount, status: 'pending' },
      ])
      setWithdrawalAmount('')
      try {
        await refreshWalletRecords()
      } catch (refreshError) {
        setWithdrawalError(`Withdrawal request was saved, but your wallet could not refresh: ${refreshError instanceof Error ? refreshError.message : 'Unknown error.'}`)
      }
      try {
        await syncTransactionToSheet('withdrawal_requests', data)
        setWithdrawalNotice('Withdrawal request submitted for review and sent to the spreadsheet. Payout is not automatic.')
      } catch (syncError) {
        setWithdrawalNotice(`Withdrawal request was saved, but spreadsheet sync failed: ${syncError instanceof Error ? syncError.message : 'Unknown sync error'}`)
      }
    } catch (requestError) {
      setWithdrawalError(requestError instanceof Error ? requestError.message : 'Could not submit the withdrawal request.')
    } finally {
      setWithdrawalBalanceLoading(false)
      setWithdrawalBusy(false)
    }
  }

  async function purchaseSelectedPackage() {
    if (!supabase || !selectedPlan?.id) {
      setPackagePurchaseError('This package is not ready to purchase. Refresh the page and try again.')
      return
    }

    setPackagePurchaseBusy(true)
    setPackagePurchaseError('')
    setPackagePurchaseNotice('')
    try {
      const { error } = await supabase.rpc('purchase_package', { p_plan_id: selectedPlan.id })
      if (error) throw error

      setPackagePurchaseNotice(`The $${selectedPlan.amount} package is active. Its cost was deducted from your wallet.`)
      try {
        await refreshWalletRecords()
      } catch (refreshError) {
        setPackagePurchaseError(`Package purchase succeeded, but account data could not refresh: ${refreshError instanceof Error ? refreshError.message : 'Unknown error.'}`)
      }
    } catch (requestError) {
      setPackagePurchaseError(requestError instanceof Error ? requestError.message : 'Could not purchase this package.')
    } finally {
      setPackagePurchaseBusy(false)
    }
  }

  const totalBalance = ledgerEntries.reduce((total, entry) => {
    const amount = Number(entry.amount_usd)
    if (['withdrawal', 'package_purchase'].includes(entry.entry_type)) return total - amount
    if (['deposit', 'task_reward', 'referral_commission', 'refund', 'adjustment'].includes(entry.entry_type)) {
      return total + amount
    }
    return total
  }, 0)
  const reservedWithdrawals = withdrawalRequests
    .filter((request) => ['pending', 'processing'].includes(request.status))
    .reduce((total, request) => total + Number(request.amount_usd), 0)
  const calculatedAvailableBalance = Math.floor(Math.max(0, totalBalance - reservedWithdrawals) * 100) / 100
  const availableBalance = databaseAvailableBalance ?? calculatedAvailableBalance
  const withdrawalFee = Math.round(Number(withdrawalAmount || 0) * 5) / 100
  const withdrawalPayout = Math.max(0, Number(withdrawalAmount || 0) - withdrawalFee)
  const withdrawalSuggestions = [5, 10, 20, 50, 100]
    .filter((amount) => amount <= availableBalance)
  if (availableBalance >= 5 && !withdrawalSuggestions.includes(availableBalance)) {
    withdrawalSuggestions.push(availableBalance)
  }
  const todayReward = ledgerEntries
    .filter((entry) => entry.entry_type === 'task_reward' && entry.created_at?.slice(0, 10) === today)
    .reduce((total, entry) => total + Number(entry.amount_usd), 0)
  const walletActivity = [
    ...depositRequests.map((request) => ({
      id: `deposit:${request.id}`,
      type: 'Deposit',
      amount: Number(request.amount_usd),
      status: request.status === 'confirmed' ? 'Approved' : request.status[0].toUpperCase() + request.status.slice(1),
      createdAt: request.created_at,
    })),
    ...ledgerEntries
      .filter((entry) => entry.entry_type === 'task_reward')
      .map((entry, index) => ({
        id: `video-earning:${entry.created_at}:${index}`,
        type: 'Task reward',
        amount: Number(entry.amount_usd),
        status: 'Earned',
        createdAt: entry.created_at,
      })),
  ].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
  const approvedToday = taskCompletions.filter((completion) => completion.status === 'approved').length
  const earningPackages = packages.filter((item) => (
    item.status === 'active'
    && item.plans?.active
  ))
  const availableTaskLimit = earningPackages
    .reduce((total, item) => total + (item.plans?.daily_task_limit ?? 0), 0)
  const availableDailyReward = earningPackages
    .reduce((total, item) => total + Number(item.plans?.daily_reward_usd ?? 0), 0)
  const taskReward = availableTaskLimit ? availableDailyReward / availableTaskLimit : 0
  const taskCooldownSeconds = taskProgress.resets_at && taskClockNow
    ? Math.max(0, Math.ceil((new Date(taskProgress.resets_at).getTime() - taskClockNow) / 1000))
    : 0
  const taskCooldownLabel = taskClockNow
    ? `${String(Math.floor(taskCooldownSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((taskCooldownSeconds % 3600) / 60)).padStart(2, '0')}:${String(taskCooldownSeconds % 60).padStart(2, '0')}`
    : '--:--:--'
  const taskSlots = tasks.length && availableTaskLimit > 0
    ? Array.from({ length: availableTaskLimit }, (_, index) => ({
        ...tasks[index % tasks.length],
        task_slot: index + 1,
        title: `${tasks[index % tasks.length].title} (Task ${index + 1})`,
      }))
    : []

  async function startVideoTask(task) {
    if (!supabase || !session?.user.id) return
    setWatchError('')
    setWatchBusy(true)
    try {
      const { error } = await supabase.rpc('begin_video_task', {
        p_task_id: task.id,
        p_task_slot: task.task_slot,
      })
      if (error) throw error

      setTaskCompletions((current) => current.some((completion) => completion.task_slot === task.task_slot)
        ? current
        : [...current, {
            id: `pending:${task.task_slot}`,
            task_id: task.id,
            task_slot: task.task_slot,
            status: 'pending',
          }])
      refreshTaskProgress().catch((requestError) => {
        setAppError(requestError instanceof Error ? requestError.message : 'Task started, but progress could not refresh.')
      })
      taskCompletionInProgress.current = false
      setWatchTask(task)
      setWatchedSeconds(0)
      setVideoPlaying(false)
      setWatchCompleted(false)
      setModal('task')
    } catch (requestError) {
      setAppError(requestError instanceof Error ? requestError.message : 'Could not start this video task.')
    } finally {
      setWatchBusy(false)
    }
  }

  const completeVideoTask = useCallback(async (task) => {
    if (!supabase || !task || taskCompletionInProgress.current || watchedSeconds < 30) return
    taskCompletionInProgress.current = true
    setWatchBusy(true)
    setWatchError('')
    try {
      const { data, error } = await supabase.rpc('complete_video_task', {
        p_task_id: task.id,
        p_task_slot: task.task_slot,
      })
      if (error) throw error

      const reward = Number(data.reward_usd)
      setTaskCompletions((current) => [
        ...current.filter((completion) => completion.task_slot !== task.task_slot),
        {
          id: data.completion_id,
          task_id: task.id,
          task_slot: task.task_slot,
          status: 'approved',
          completed_on: today,
        },
      ])
      setLedgerEntries((current) => [
        {
          entry_type: 'task_reward',
          amount_usd: reward,
          status: 'confirmed',
          created_at: data.created_at,
        },
        ...current,
      ])
      try {
        await refreshTaskProgress()
      } catch (progressError) {
        setAppError(`Task reward saved, but progress could not refresh: ${progressError instanceof Error ? progressError.message : 'Unknown error.'}`)
      }
      setWatchCompleted(true)
      setVideoPlaying(false)
      if (videoElement.current) videoElement.current.pause()
    } catch (requestError) {
      taskCompletionInProgress.current = false
      setWatchError(requestError instanceof Error ? requestError.message : 'Could not confirm the task reward.')
    } finally {
      setWatchBusy(false)
    }
  }, [refreshTaskProgress, today, watchedSeconds])

  useEffect(() => {
    if (watchedSeconds >= 30 && watchTask && !watchCompleted) {
      const timer = window.setTimeout(() => completeVideoTask(watchTask), 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [watchedSeconds, watchTask, watchCompleted, completeVideoTask])

  function closeVideoTask() {
    if (videoElement.current) videoElement.current.pause()
    setVideoPlaying(false)
    setWatchTask(null)
    setWatchCompleted(false)
    setWatchError('')
    setModal(null)
  }

  function renderTaskCard(task, index) {
    const completion = taskCompletions.find((item) => item.task_slot === task.task_slot)
    const completed = completion?.status === 'approved'
    const inProgress = completion?.status === 'pending'
    const coolingDown = taskCooldownSeconds > 0
    const disabled = watchBusy
      || !session?.user.id
      || availableTaskLimit === 0
      || !isTaskWeekday
      || completed
      || coolingDown
      || (!inProgress && approvedToday >= availableTaskLimit)

    return (
      <article className={completed ? 'task-card completed' : 'task-card'} key={task.task_slot}>
        <div className="task-icon">{String(index + 1).padStart(2, '0')}</div>
        <div className="task-info">
          <h3>{task.title}</h3>
          <p>{completed ? 'Reward added to your balance' : task.video_url ? 'Watch for 30 seconds' : 'Task details'}</p>
        </div>
        <div className="task-reward">
          <strong>{availableTaskLimit ? `$${taskReward.toFixed(2)}` : '—'}</strong>
          <button
            type="button"
            disabled={disabled}
            onClick={() => startVideoTask(task)}
          >
            {completed ? 'Completed' : !isTaskWeekday ? 'Weekdays only' : coolingDown ? `Available in ${taskCooldownLabel}` : inProgress ? 'Continue' : !session?.user.id ? 'Sign in' : availableTaskLimit === 0 ? 'Package required' : approvedToday >= availableTaskLimit ? 'Daily limit' : watchBusy ? 'Loading…' : 'Watch video'}
          </button>
        </div>
      </article>
    )
  }

  if (isSupabaseConfigured && authLoading) {
    return <main className="auth-page"><p className="auth-description">Loading your secure session…</p></main>
  }

  if (isSupabaseConfigured && !session) {
    return <AuthScreen message={authError} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActive('Overview')} aria-label="Reap home">
          <span className="brand-mark"><span /></span>
          <span>reap</span>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          {[
            ['Overview', 'grid'],
            ['Tasks', 'activity'],
            ['Wallet', 'wallet'],
            ['Packages', 'package'],
            ['Activity', 'activity'],
            ['Referrals', 'user'],
            ['Settings', 'settings'],
            ...(canReviewTransactions ? [['Review', 'activity']] : []),
          ].map(([label, icon]) => (
            <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => setActive(label)} aria-current={active === label ? 'page' : undefined}>
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item"><Icon name="support" /><span>Help center</span></button>
          {isSupabaseConfigured
            ? <button className="nav-item" onClick={handleSignOut}><Icon name="user" /><span>Sign out</span></button>
            : <div className="nav-item preview-label"><Icon name="user" /><span>Preview mode</span></div>}
        </div>
      </aside>

      <main className="main-content">
        {!isSupabaseConfigured && (
          <div className="preview-notice" role="status">
            <strong>Preview mode</strong>
            <span>Dashboard access is open. Connect Supabase to enable accounts, referrals, and saved data. Crypto deposits and withdrawals are not active.</span>
          </div>
        )}
        {appError && <p className="auth-error" role="alert">{appError}</p>}
        {packagePurchaseNotice && <p className="auth-notice" role="status">{packagePurchaseNotice}</p>}
        <header className="topbar">
          <div>
            <p className="eyebrow">{formatUtcDate(today)}</p>
            <h1>{active}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications"><Icon name="bell" /><span className="notification-dot" /></button>
            <button className="avatar" aria-label="Open settings" onClick={() => setActive('Settings')}>
              {(profile?.display_name || session?.user.email || 'U').trim().slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>

        {active === 'Overview' && (
          <>
            <section className="balance-card">
              <div className="balance-main">
                <p>Total balance</p>
                <div className="balance-row">
                  <h2>${totalBalance.toFixed(2)}</h2>
                </div>
                <div className="balance-actions">
                  <button className="primary-button" onClick={() => openModal('deposit')}><Icon name="down" size={17} />Deposit</button>
                  <button className="secondary-button" onClick={() => openModal('withdraw')}><Icon name="up" size={17} />Withdraw</button>
                </div>
              </div>
              <div className="earnings">
                <div className="earnings-head"><span>Today's earnings</span><strong>${todayReward.toFixed(2)}</strong></div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${availableTaskLimit ? Math.min(100, approvedToday / availableTaskLimit * 100) : 0}%` }} /></div>
                <p><b>{approvedToday} of {availableTaskLimit}</b> tasks completed</p>
              </div>
            </section>

            <section className="section-heading">
              <div><p className="eyebrow">Today</p><h2>Task list</h2></div>
              <button className="text-button" onClick={() => setActive('Tasks')}>View all tasks <Icon name="arrow" size={16} /></button>
            </section>

            <section className="task-grid">
              {taskSlots.length
                ? taskSlots.slice(0, 5).map(renderTaskCard)
                : [0, 1, 2, 3, 4].map((task) => (
                    <article className="task-card" key={task}>
                      <div className="task-icon">{String(task + 1).padStart(2, '0')}</div>
                      <div className="task-info">
                        <h3>{dataLoading ? 'Loading tasks…' : 'No active tasks'}</h3>
                        <p>{dataLoading ? 'Reading the database' : 'Check back later'}</p>
                      </div>
                      <div className="task-reward">
                        <strong>—</strong>
                        <button disabled>{dataLoading ? 'Loading' : 'Unavailable'}</button>
                      </div>
                    </article>
                  ))}
            </section>
            {taskCooldownSeconds > 0 && (
              <p className="task-cooldown" role="status">All tasks complete. New tasks unlock in <strong>{taskCooldownLabel}</strong>.</p>
            )}
            {!isTaskWeekday && (
              <p className="task-cooldown" role="status">Video tasks are available Monday through Friday (Africa/Kampala time).</p>
            )}

            <section className="section-heading package-heading">
              <div><p className="eyebrow">Increase your earnings</p><h2>Packages</h2></div>
              <button className="text-button" onClick={() => setActive('Packages')}>View all <Icon name="arrow" size={16} /></button>
            </section>

            <section className="package-strip">
              {dbPlans.slice(0, 4).map((plan) => (
                <article className="package-card" style={{ '--plan-accent': plan.accent }} key={plan.amount}>
                  {plan.popular && <span className="popular">Popular</span>}
                  <p>Package</p>
                  <h3>${plan.amount}</h3>
                  <div className="package-details">
                    <span><b>{plan.tasks}</b> tasks daily</span>
                    <span>Earn <b>${plan.daily}</b> daily</span>
                  </div>
                  <button onClick={() => { setSelectedPlan(plan); openModal('choose') }}>Choose package</button>
                </article>
              ))}
            </section>
          </>
        )}

        {active !== 'Overview' && (
          <section className="placeholder-panel">
            {active === 'Tasks' ? (
              <section className="tasks-page">
                <div className="review-page-heading">
                  <div>
                    <p className="eyebrow">Paid activity</p>
                    <h2>Video tasks</h2>
                    <p>
                      {availableTaskLimit
                        ? `${availableTaskLimit} task slots from your active packages. Each task earns $${taskReward.toFixed(2)} after watching for 30 seconds.`
                        : 'Purchase an active package to unlock video tasks.'}
                    </p>
                  </div>
                </div>
                {!isTaskWeekday && (
                  <p className="task-cooldown" role="status">Video tasks are available Monday through Friday (Africa/Kampala time).</p>
                )}
                {taskCooldownSeconds > 0 && (
                  <p className="task-cooldown" role="status">You completed all tasks. They renew in <strong>{taskCooldownLabel}</strong>.</p>
                )}
                <div className="task-grid">
                  {taskSlots.length
                    ? taskSlots.map(renderTaskCard)
                    : <p className="review-empty">{dataLoading ? 'Loading your tasks…' : tasks.length ? 'An active package is required to show tasks.' : 'No video tasks are available right now.'}</p>}
                </div>
              </section>
            ) : active === 'Activity' ? (
              <section className="wallet-history">
                <div className="review-page-heading">
                  <div>
                    <p className="eyebrow">Your account</p>
                    <h2>Recent activity</h2>
                    <p>Deposits and rewards from completed video tasks.</p>
                  </div>
                  <button
                    className="secondary-button review-refresh"
                    type="button"
                    onClick={() => refreshWalletRecords().catch((requestError) => {
                      setAppError(requestError instanceof Error ? requestError.message : 'Could not refresh activity.')
                    })}
                  >
                    Refresh
                  </button>
                </div>
                <div className="review-table-wrap">
                  <table className="review-table wallet-table">
                    <thead>
                      <tr><th>Activity</th><th>Amount</th><th>Status</th><th>Date</th></tr>
                    </thead>
                    <tbody>
                      {walletActivity.map((item) => (
                        <tr key={item.id}>
                          <td>{item.type}</td>
                          <td><strong>${item.amount.toFixed(2)}</strong></td>
                          <td><span className={`wallet-status ${item.status.toLowerCase()}`}>{item.status}</span></td>
                          <td>{new Date(item.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                      {!dataLoading && walletActivity.length === 0 && (
                        <tr><td className="review-empty" colSpan="4">No deposits or task rewards yet.</td></tr>
                      )}
                      {dataLoading && walletActivity.length === 0 && (
                        <tr><td className="review-empty" colSpan="4">Loading activity…</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : active === 'Packages' ? (
              <div className="full-package-grid">
                {dbPlans.map((plan) => (
                  <article className="package-card" style={{ '--plan-accent': plan.accent }} key={plan.amount}>
                    {plan.popular && <span className="popular">Popular</span>}
                    <p>Package</p><h3>${plan.amount}</h3>
                    <div className="package-details"><span><b>{plan.tasks}</b> tasks daily</span><span>Earn <b>${plan.daily}</b> daily</span></div>
                    <button onClick={() => { setSelectedPlan(plan); openModal('choose') }}>Choose package</button>
                  </article>
                ))}
              </div>
            ) : active === 'Wallet' ? (
              <section className="wallet-history">
                <div className="review-page-heading">
                  <div>
                    <p className="eyebrow">Your account</p>
                    <h2>Wallet activity</h2>
                    <p>Approved and rejected deposits, plus earnings from completed video tasks.</p>
                  </div>
                  <button
                    className="secondary-button review-refresh"
                    type="button"
                    onClick={() => refreshWalletRecords().catch((requestError) => {
                      setAppError(requestError instanceof Error ? requestError.message : 'Could not refresh wallet activity.')
                    })}
                  >
                    Refresh
                  </button>
                </div>
                <div className="review-table-wrap">
                  <table className="review-table wallet-table">
                    <thead>
                      <tr><th>Activity</th><th>Amount</th><th>Status</th><th>Date</th></tr>
                    </thead>
                    <tbody>
                      {walletActivity.map((item) => (
                        <tr key={item.id}>
                          <td>{item.type}</td>
                          <td><strong>${item.amount.toFixed(2)}</strong></td>
                          <td><span className={`wallet-status ${item.status.toLowerCase()}`}>{item.status}</span></td>
                          <td>{new Date(item.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                      {!dataLoading && walletActivity.length === 0 && (
                        <tr><td className="review-empty" colSpan="4">No deposits or video earnings yet.</td></tr>
                      )}
                      {dataLoading && walletActivity.length === 0 && (
                        <tr><td className="review-empty" colSpan="4">Loading wallet activity…</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : active === 'Referrals' ? (
              <div className="referral-page">
                <section className="referral-intro">
                  <p className="eyebrow">Grow your community</p>
                  <h2>Share Reap with your network</h2>
                  <p>Earn 10% when someone you directly invite makes their first approved deposit.</p>
                  <div className="referral-share">
                    <div>
                      <span>Your referral link</span>
                      {referralCode && !referralLoading
                        ? <a className="referral-full-link" href={getReferralUrl(window.location.origin, referralCode)}>{getReferralUrl(window.location.origin, referralCode)}</a>
                        : <strong>{referralLoading ? 'Loading…' : 'Unavailable'}</strong>}
                    </div>
                    <button className="referral-copy-button" type="button" onClick={copyReferralLink} disabled={!referralCode || referralLoading} aria-label="Copy referral link" title="Copy referral link">
                      <Icon name="copy" />
                      <span>{referralCopied ? 'Copied!' : 'Copy'}</span>
                    </button>
                  </div>
                </section>
                {referralError && <p className="auth-error" role="alert">{referralError}</p>}
                <span className="sr-only" role="status">{referralCopied ? 'Referral link copied.' : ''}</span>
                <div className="referral-levels">
                  <article className="referral-level-card">
                    <div><span>Direct referrals</span><strong>10%</strong></div>
                    <p>of each referred user's first approved deposit</p>
                    <div className="referral-metrics">
                      <span><b>{referralSummary?.level_1_count ?? '—'}</b> referrals</span>
                      <span><b>${(Number(referralSummary?.level_1_earnings ?? 0) + Number(referralSummary?.level_2_earnings ?? 0) + Number(referralSummary?.level_3_earnings ?? 0)).toFixed(2)}</b> earned</span>
                    </div>
                  </article>
                </div>
                <p className="referral-disclaimer">Rewards are credited once per referred user after their first deposit is approved. Earnings include any historical referral commissions.</p>
              </div>
            ) : active === 'Settings' ? (
              <section className="settings-card">
                <div className="settings-heading">
                  <p className="eyebrow">Account</p>
                  <h2>Personal details</h2>
                  <p>Update the name and phone number associated with your account.</p>
                </div>
                {isSupabaseConfigured && session?.user ? (
                  <>
                    <form className="settings-form" onSubmit={saveProfile}>
                      <label>
                        Full name
                        <input
                          name="display_name"
                          type="text"
                          autoComplete="name"
                          maxLength="80"
                          value={profileName}
                          onChange={(event) => setProfileName(event.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Phone number
                        <input
                          name="phone_number"
                          type="tel"
                          autoComplete="tel"
                          maxLength="32"
                          value={profilePhone}
                          onChange={(event) => setProfilePhone(event.target.value)}
                        />
                      </label>
                      <label>
                        Email
                        <input type="email" value={session.user.email || ''} readOnly />
                      </label>
                      {profileError && <p className="auth-error" role="alert">{profileError}</p>}
                      {profileNotice && <p className="auth-notice" role="status">{profileNotice}</p>}
                      <button className="primary-button" type="submit" disabled={profileBusy}>
                        {profileBusy ? 'Saving…' : 'Save changes'}
                      </button>
                    </form>
                    <div className="settings-signout">
                      <div>
                        <h3>Sign out</h3>
                        <p>End your current Reap session on this device.</p>
                      </div>
                      <button className="settings-signout-button" type="button" onClick={handleSignOut}>Sign out</button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state settings-empty">
                    <div className="empty-icon"><Icon name="user" size={28} /></div>
                    <h2>Sign in to manage your account</h2>
                    <p>Your profile settings are available after you connect and sign in.</p>
                  </div>
                )}
              </section>
            ) : active === 'Review' && canReviewTransactions ? (
              <section className="review-page">
                <div className="review-page-heading">
                  <div>
                    <p className="eyebrow">Admin tools</p>
                    <h2>Transaction requests</h2>
                    <p>Verify each transfer before approving. Deposits credit the wallet; withdrawals are debited only after payout.</p>
                  </div>
                  <button className="secondary-button review-refresh" type="button" onClick={loadReviewQueue} disabled={reviewLoading}>
                    {reviewLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
                {reviewError && <p className="auth-error" role="alert">{reviewError}</p>}
                {reviewNotice && <p className="auth-notice" role="status">{reviewNotice}</p>}
                <div className="review-table-wrap">
                  <table className="review-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>User</th>
                        <th>Amount</th>
                        <th>Details / proof</th>
                        <th>Submitted</th>
                        <th>Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReviewQueue.map((request) => (
                        <tr key={`${request.request_type}:${request.id}`}>
                          <td><span className={`review-type ${request.request_type}`}>{request.request_type}</span></td>
                          <td>
                            <strong>{request.display_name || 'User'}</strong>
                            <span className="review-secondary">{request.user_email}</span>
                            <span className="review-secondary">ID: {request.user_id}</span>
                          </td>
                          <td><strong>${Number(request.amount_usd).toFixed(2)}</strong> {request.asset}</td>
                          <td>
                            {request.request_type === 'deposit' ? (
                              request.proof_path && reviewProofUrls[request.id]
                                ? <a href={reviewProofUrls[request.id]} target="_blank" rel="noreferrer"><img className="review-proof" src={reviewProofUrls[request.id]} alt="Uploaded deposit proof" /></a>
                                : <span className="review-secondary">No screenshot uploaded</span>
                            ) : (
                              <>
                                <span>{request.network}</span>
                                <span className="review-secondary review-wallet-address">{request.destination_address}</span>
                              </>
                            )}
                          </td>
                          <td>{new Date(request.created_at).toLocaleString()}</td>
                          <td>
                            <div className="review-actions">
                              <button
                                type="button"
                                className="review-approve"
                                onClick={() => reviewTransaction(request, 'approve')}
                                disabled={reviewLoading || reviewBusyKey === `${request.request_type}:${request.id}` || (request.request_type === 'deposit' && !request.proof_path)}
                              >
                                {reviewBusyKey === `${request.request_type}:${request.id}` ? 'Working…' : request.request_type === 'withdrawal' ? 'Approve & mark paid' : 'Approve & credit'}
                              </button>
                              <button
                                type="button"
                                className="review-reject"
                                onClick={() => reviewTransaction(request, 'reject')}
                                disabled={reviewLoading || reviewBusyKey === `${request.request_type}:${request.id}`}
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!reviewLoading && visibleReviewQueue.length === 0 && (
                        <tr><td className="review-empty" colSpan="6">There are no pending deposit or withdrawal requests.</td></tr>
                      )}
                      {reviewLoading && visibleReviewQueue.length === 0 && (
                        <tr><td className="review-empty" colSpan="6">Loading transaction requests…</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="review-footnote">For withdrawals, send the USDT payout manually before clicking “Approve &amp; mark paid.” Rejection releases the reserved amount. Decisions are recorded in the ledger once.</p>
              </section>
            ) : (
              <div className="empty-state">
                <div className="empty-icon"><Icon name={active === 'Wallet' ? 'wallet' : active === 'Activity' ? 'activity' : 'package'} size={28} /></div>
                <h2>{active}</h2>
                <p>Your {active.toLowerCase()} will appear here.</p>
              </div>
            )}
          </section>
        )}
      </main>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && (modal === 'task' ? closeVideoTask() : setModal(null))}>
          <section className={modal === 'task' ? 'modal task-modal' : 'modal'} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" onClick={() => modal === 'task' ? closeVideoTask() : setModal(null)} aria-label="Close">×</button>
            {modal === 'task' ? (
              <>
                <p className="eyebrow">Video task</p>
                <h2 id="modal-title">{watchTask?.title}</h2>
                <p className="preview-modal-note">Watch this video for at least 30 seconds to complete the task.</p>
                <video
                  ref={videoElement}
                  className="task-video-player"
                  src={watchTask?.video_url}
                  controls
                  playsInline
                  preload="metadata"
                  onPlay={() => setVideoPlaying(true)}
                  onPause={() => setVideoPlaying(false)}
                  onEnded={() => setVideoPlaying(false)}
                />
                {watchCompleted ? (
                  <p className="auth-notice" role="status">Task complete. ${taskReward.toFixed(2)} has been added to your balance.</p>
                ) : (
                  <>
                    <p className="task-timer" role="status">
                      {watchBusy ? 'Confirming your reward…' : videoPlaying ? `Keep watching: ${30 - watchedSeconds} seconds remaining` : `Play the video to start: ${30 - watchedSeconds} seconds remaining`}
                    </p>
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${watchedSeconds / 30 * 100}%` }} /></div>
                  </>
                )}
                {watchError && <p className="auth-error" role="alert">{watchError}</p>}
                {watchError && watchedSeconds >= 30 && (
                  <button className="primary-button wide" onClick={() => completeVideoTask(watchTask)} disabled={watchBusy}>Retry reward confirmation</button>
                )}
              </>
            ) : modal === 'choose' ? (
              <>
                <p className="eyebrow">Selected package</p>
                <h2 id="modal-title">${selectedPlan.amount} package</h2>
                <div className="modal-summary"><span>{selectedPlan.tasks} daily tasks</span><span>${selectedPlan.daily} daily earnings</span><span>365 day term</span></div>
                {packageBalanceLoading ? (
                  <p className="preview-modal-note">Checking your latest wallet balance…</p>
                ) : isSupabaseConfigured && databaseAvailableBalance === null ? (
                  <p className="auth-error" role="alert">Your wallet balance could not be verified. Refresh the page and try again.</p>
                ) : (
                  <p className="withdrawal-available">Wallet balance: <strong>${availableBalance.toFixed(2)}</strong></p>
                )}
                <p className="preview-modal-note">Buying this package deducts ${selectedPlan.amount} from your wallet and activates video tasks. Any remaining wallet balance stays available.</p>
                {packagePurchaseError && <p className="auth-error" role="alert">{packagePurchaseError}</p>}
                {packagePurchaseNotice && <p className="auth-notice" role="status">{packagePurchaseNotice}</p>}
                <button
                  className="primary-button wide"
                  onClick={purchaseSelectedPackage}
                  disabled={!isSupabaseConfigured || packageBalanceLoading || packagePurchaseBusy || databaseAvailableBalance === null || !selectedPlan.id || availableBalance < selectedPlan.amount}
                >
                  {packagePurchaseBusy ? 'Purchasing…' : `Buy package for $${selectedPlan.amount}`}
                </button>
                {!packageBalanceLoading && databaseAvailableBalance !== null && availableBalance < selectedPlan.amount && (
                  <button className="secondary-button wide" onClick={() => openModal('deposit')}>Deposit funds</button>
                )}
              </>
            ) : modal === 'deposit' ? (
              <>
                <p className="eyebrow">Add funds</p>
                <h2 id="modal-title">Deposit crypto</h2>
                <form onSubmit={submitDepositRequest}>
                  <label>Amount (USD)
                    <input type="number" min="5" step="0.01" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} required />
                  </label>
                  <label>Cryptocurrency
                    <select value="USDT" disabled><option value="USDT">USDT</option></select>
                  </label>
                  <label>Network
                    <select value={depositNetwork} disabled><option value="TRC20">TRON (TRC20)</option></select>
                  </label>
                  <div className="deposit-address">
                    <span>USDT deposit address (TRC20)</span>
                    <code>{tronDepositAddress}</code>
                    <button className="secondary-button wide" type="button" onClick={copyDepositAddress}>
                      {addressCopied ? 'Address copied' : 'Copy deposit address'}
                    </button>
                    <p className="preview-modal-note">Send USDT on TRON (TRC20) only. Do not send other tokens.</p>
                  </div>
                  <label>Transfer screenshot
                    <input
                      ref={depositProofInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => setDepositProofFile(event.target.files?.[0] ?? null)}
                      required
                    />
                    <span className="file-hint">JPG, PNG, or WebP; maximum 5 MB.</span>
                  </label>
                  <p className="preview-modal-note">After you submit the request, its status will be waiting for approval.</p>
                  {depositError && <p className="auth-error" role="alert">{depositError}</p>}
                  {depositNotice && <p className="auth-notice" role="status">{depositNotice}</p>}
                  <button className="primary-button wide" type="submit" disabled={!isSupabaseConfigured || depositBusy}>
                    {depositBusy ? 'Submitting…' : 'Submit deposit request'}
                  </button>
                </form>
              </>
            ) : (
              <>
                <p className="eyebrow">Cash out</p>
                <h2 id="modal-title">Withdraw USDT</h2>
                <p className="preview-modal-note">Withdrawals can be submitted from 9:00 AM to 4:00 PM Africa/Kampala time.</p>
                {dataLoading ? (
                  <p className="preview-modal-note">Loading your available balance…</p>
                ) : isSupabaseConfigured && databaseAvailableBalance === null ? (
                  <p className="auth-error" role="alert">Your available balance could not be verified. Refresh the page and try again.</p>
                ) : withdrawalBalanceLoading ? (
                  <p className="preview-modal-note">Checking your latest available balance…</p>
                ) : availableBalance < 5 ? (
                  <p className="preview-modal-note">Withdrawals start at $5.00. Your available balance is ${availableBalance.toFixed(2)}.</p>
                ) : (
                  <form onSubmit={submitWithdrawal}>
                    <p className="withdrawal-available">Available to withdraw: <strong>${availableBalance.toFixed(2)}</strong></p>
                    <label>Amount to withdraw (USD)
                      <input
                        type="number"
                        min="5"
                        max={availableBalance.toFixed(2)}
                        step="0.01"
                        value={withdrawalAmount}
                        onChange={(event) => setWithdrawalAmount(event.target.value)}
                        required
                      />
                    </label>
                    <div className="withdrawal-options" aria-label="Suggested withdrawal amounts">
                      {withdrawalSuggestions.map((amount) => (
                        <button
                          key={amount}
                          className={Number(withdrawalAmount) === amount ? 'secondary-button selected' : 'secondary-button'}
                          type="button"
                          aria-pressed={Number(withdrawalAmount) === amount}
                          onClick={() => setWithdrawalAmount(amount.toFixed(2))}
                        >
                          {amount === availableBalance ? `Max $${amount.toFixed(2)}` : `$${amount}`}
                        </button>
                      ))}
                    </div>
                    <label>Network
                      <select value={withdrawalNetwork} onChange={(event) => setWithdrawalNetwork(event.target.value)}>
                        <option value="TRC20">TRON (TRC20)</option>
                        <option value="BEP20">BNB (BEP20)</option>
                      </select>
                    </label>
                    <label>USDT receiving wallet address
                      <input
                        type="text"
                        autoComplete="off"
                        minLength="20"
                        maxLength="128"
                        value={withdrawalAddress}
                        onChange={(event) => setWithdrawalAddress(event.target.value)}
                        required
                      />
                    </label>
                    <div className="withdrawal-summary">
                      <span>Withdrawal amount <strong>${Number(withdrawalAmount || 0).toFixed(2)}</strong></span>
                      <span>5% fee <strong>−${withdrawalFee.toFixed(2)}</strong></span>
                      <span>Estimated payout <strong>${withdrawalPayout.toFixed(2)} USDT</strong></span>
                    </div>
                    <p className="preview-modal-note">Minimum $5.00. The 5% fee is deducted from the requested amount. Requests are subject to review; payout is not automatic. Check the network and address carefully.</p>
                    {withdrawalError && <p className="auth-error" role="alert">{withdrawalError}</p>}
                    {withdrawalNotice && <p className="auth-notice" role="status">{withdrawalNotice}</p>}
                    <button className="primary-button wide" type="submit" disabled={!isSupabaseConfigured || withdrawalBusy || withdrawalBalanceLoading || !isWithdrawalWindowOpen || Number(withdrawalAmount) < 5 || Number(withdrawalAmount) > availableBalance}>
                      {withdrawalBusy ? 'Submitting…' : isWithdrawalWindowOpen ? 'Submit withdrawal request' : 'Available 9:00 AM–4:00 PM EAT'}
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default App
