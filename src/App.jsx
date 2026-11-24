import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'

const tronDepositAddress = 'TL2Lv1QKRgswFNLJ9km6HzHMr8WaSsH3ij'
const authSessionStartedKey = 'reap.auth-session-started-at'
const siteClosedAtKey = 'reap.site-closed-at'
const maximumSessionAgeMs = 5 * 60 * 1000
const closedSiteGraceMs = 10 * 1000
const localTaskVideoUrls = [
  '/task%20videos/12248500_1920_1080_30fps.mp4',
  '/task%20videos/13649040_1920_1080_30fps.mp4',
  '/task%20videos/15257423_1920_1080_60fps.mp4',
]

function getUtcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function formatUtcDate(dateKey) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${dateKey}T00:00:00.000Z`))
}

function getReferralCodeFromUrl() {
  const queryCode = new URLSearchParams(window.location.search).get('ref')
  const pathCode = window.location.pathname.split('/').filter(Boolean)[0]
  return (queryCode || pathCode || '').trim().toUpperCase()
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
  const [mode, setMode] = useState('sign-in')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [referralCode, setReferralCode] = useState(getReferralCodeFromUrl)

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
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function App() {
  const [active, setActive] = useState('Overview')
  const [today, setToday] = useState(getUtcDateKey)
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
  const [depositTransactionId, setDepositTransactionId] = useState('')
  const [depositBusy, setDepositBusy] = useState(false)
  const [depositNotice, setDepositNotice] = useState('')
  const [depositError, setDepositError] = useState('')
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
  const [withdrawalNetwork, setWithdrawalNetwork] = useState('TRC20')
  const [withdrawalAddress, setWithdrawalAddress] = useState('')
  const [withdrawalRequests, setWithdrawalRequests] = useState([])
  const [withdrawalBusy, setWithdrawalBusy] = useState(false)
  const [withdrawalError, setWithdrawalError] = useState('')
  const [withdrawalNotice, setWithdrawalNotice] = useState('')
  const [dbPlans, setDbPlans] = useState(plans)
  const [selectedPlan, setSelectedPlan] = useState(plans[2])
  const [tasks, setTasks] = useState([])
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [packages, setPackages] = useState([])
  const [taskCompletions, setTaskCompletions] = useState([])
  const [profile, setProfile] = useState(null)
  const [profileName, setProfileName] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
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

    updateToday()
    document.addEventListener('visibilitychange', updateWhenVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', updateWhenVisible)
    }
  }, [])

  const openModal = (type) => {
    if (type === 'deposit') {
      setDepositNetwork('TRC20')
      setAddressCopied(false)
      setDepositAmount(String(selectedPlan.amount))
      setDepositTransactionId('')
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
        const [profileResult, ledgerResult, packagesResult, completionsResult, withdrawalRequestsResult] = await Promise.all([
          supabase.from('profiles').select('id, display_name, phone_number, referral_code').eq('id', session.user.id).single(),
          supabase.from('ledger_entries').select('entry_type, amount_usd, status, created_at').eq('user_id', session.user.id).eq('status', 'confirmed').order('created_at', { ascending: false }),
          supabase.from('user_packages').select('id, status, starts_at, ends_at, plans(amount_usd, daily_task_limit, daily_reward_usd, active)').eq('user_id', session.user.id).order('created_at', { ascending: false }),
          supabase.from('task_completions').select('id, task_id, status, completed_on').eq('user_id', session.user.id).eq('completed_on', today),
          supabase.from('withdrawal_requests').select('id, amount_usd, status').eq('user_id', session.user.id).in('status', ['pending', 'processing']),
        ])

        if (!activeRequest) return

          if (!profileResult.error) {
            setProfile(profileResult.data)
            setProfileName(profileResult.data.display_name || '')
            setProfilePhone(profileResult.data.phone_number || '')
          }
        if (!ledgerResult.error) setLedgerEntries(ledgerResult.data ?? [])
        if (!packagesResult.error) setPackages(packagesResult.data ?? [])
        if (!completionsResult.error) setTaskCompletions(completionsResult.data ?? [])
        if (!withdrawalRequestsResult.error) setWithdrawalRequests(withdrawalRequestsResult.data ?? [])

        const personalError = [
          profileResult.error,
          ledgerResult.error,
          packagesResult.error,
          completionsResult.error,
          withdrawalRequestsResult.error,
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

  async function copyReferralLink() {
    const referralUrl = `${window.location.origin}/${encodeURIComponent(referralCode)}`
    try {
      await navigator.clipboard.writeText(referralUrl)
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
    const transactionId = depositTransactionId.trim()
    if (!Number.isFinite(amount) || amount < 5) {
      setDepositError('Enter a deposit amount of at least $5.00.')
      return
    }
    if (!/^[a-fA-F0-9]{64}$/.test(transactionId)) {
      setDepositError('Enter the 64-character transaction ID from the TRON (TRC20) transfer.')
      return
    }
    if (!supabase) {
      setDepositError('Connect Supabase before submitting a deposit request.')
      return
    }

    setDepositBusy(true)
    try {
      const { data: requestId, error } = await supabase.rpc('request_deposit', {
        p_amount_usd: amount,
        p_network: 'TRC20',
        p_provider_reference: transactionId,
      })
      if (error) throw error

      try {
        await syncTransactionToSheet('deposit_requests', requestId)
        setDepositNotice('Deposit request saved and sent for manual verification.')
      } catch (syncError) {
        setDepositNotice(`Deposit request was saved, but spreadsheet sync failed: ${syncError instanceof Error ? syncError.message : 'Unknown sync error'}`)
      }
      setDepositTransactionId('')
    } catch (requestError) {
      setDepositError(requestError instanceof Error ? requestError.message : 'Could not submit the deposit request.')
    } finally {
      setDepositBusy(false)
    }
  }

  async function submitWithdrawal(event) {
    event.preventDefault()
    setWithdrawalError('')
    setWithdrawalNotice('')

    const amount = Number(withdrawalAmount)
    if (!Number.isFinite(amount) || amount < 5 || amount > availableBalance) {
      setWithdrawalError(`Enter an amount from $5.00 up to your available balance of $${availableBalance.toFixed(2)}.`)
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
        await syncTransactionToSheet('withdrawal_requests', data)
        setWithdrawalNotice('Withdrawal request submitted for review and sent to the spreadsheet. Payout is not automatic.')
      } catch (syncError) {
        setWithdrawalNotice(`Withdrawal request was saved, but spreadsheet sync failed: ${syncError instanceof Error ? syncError.message : 'Unknown sync error'}`)
      }
    } catch (requestError) {
      setWithdrawalError(requestError instanceof Error ? requestError.message : 'Could not submit the withdrawal request.')
    } finally {
      setWithdrawalBusy(false)
    }
  }

  const totalBalance = ledgerEntries.reduce((total, entry) => {
    const amount = Number(entry.amount_usd)
    if (entry.entry_type === 'withdrawal') return total - amount
    if (['deposit', 'task_reward', 'referral_commission', 'refund', 'adjustment'].includes(entry.entry_type)) {
      return total + amount
    }
    return total
  }, 0)
  const reservedWithdrawals = withdrawalRequests
    .filter((request) => ['pending', 'processing'].includes(request.status))
    .reduce((total, request) => total + Number(request.amount_usd), 0)
  const availableBalance = Math.floor(Math.max(0, totalBalance - reservedWithdrawals) * 100) / 100
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

  async function startVideoTask(task) {
    if (!supabase || !session?.user.id) return
    setWatchError('')
    setWatchBusy(true)
    try {
      const { error } = await supabase.rpc('begin_video_task', { p_task_id: task.id })
      if (error) throw error

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
      const { data, error } = await supabase.rpc('complete_video_task', { p_task_id: task.id })
      if (error) throw error

      const reward = Number(data.reward_usd)
      setTaskCompletions((current) => [
        ...current.filter((completion) => completion.task_id !== task.id),
        { id: data.completion_id, task_id: task.id, status: 'approved', completed_on: today },
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
      setWatchCompleted(true)
      setVideoPlaying(false)
      if (videoElement.current) videoElement.current.pause()
    } catch (requestError) {
      taskCompletionInProgress.current = false
      setWatchError(requestError instanceof Error ? requestError.message : 'Could not confirm the task reward.')
    } finally {
      setWatchBusy(false)
    }
  }, [today, watchedSeconds])

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
            ['Wallet', 'wallet'],
            ['Packages', 'package'],
            ['Activity', 'activity'],
            ['Referrals', 'user'],
            ['Settings', 'settings'],
          ].map(([label, icon]) => (
            <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => setActive(label)}>
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
              <button className="text-button" onClick={() => setActive('Activity')}>View activity <Icon name="arrow" size={16} /></button>
            </section>

            <section className="task-grid">
              {tasks.length
                ? tasks.slice(0, 5).map((task, index) => {
                    const completion = taskCompletions.find((item) => item.task_id === task.id)
                    const completed = completion?.status === 'approved'
                    const inProgress = completion?.status === 'pending'
                    const disabled = watchBusy
                      || !session?.user.id
                      || availableTaskLimit === 0
                      || completed
                      || (!inProgress && approvedToday >= availableTaskLimit)
                    return (
                    <article className={completed ? 'task-card completed' : 'task-card'} key={task.id}>
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
                          {completed ? 'Completed' : inProgress ? 'Continue' : !session?.user.id ? 'Sign in' : availableTaskLimit === 0 ? 'Package required' : approvedToday >= availableTaskLimit ? 'Daily limit' : watchBusy ? 'Loading…' : 'Watch video'}
                        </button>
                      </div>
                    </article>
                  )})
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
            {active === 'Packages' ? (
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
            ) : active === 'Referrals' ? (
              <div className="referral-page">
                <section className="referral-intro">
                  <p className="eyebrow">Grow your community</p>
                  <h2>Share Reap with your network</h2>
                  <p>Earn a commission when verified ad revenue is generated by people in your referral network. Deposits and package purchases do not count.</p>
                  <div className="referral-share">
                    <div><span>Your referral code</span><strong>{referralLoading ? 'Loading…' : referralCode || 'Unavailable'}</strong></div>
                    <button className="primary-button" onClick={copyReferralLink} disabled={!referralCode}>{referralCopied ? 'Copied!' : 'Copy invite link'}</button>
                  </div>
                </section>
                {referralError && <p className="auth-error" role="alert">{referralError}</p>}
                <div className="referral-levels">
                  {[
                    { level: 1, rate: '10%', count: referralSummary?.level_1_count, earnings: referralSummary?.level_1_earnings },
                    { level: 2, rate: '5%', count: referralSummary?.level_2_count, earnings: referralSummary?.level_2_earnings },
                    { level: 3, rate: '3%', count: referralSummary?.level_3_count, earnings: referralSummary?.level_3_earnings },
                  ].map(({ level, rate, count, earnings }) => (
                    <article className="referral-level-card" key={level}>
                      <div><span>Level {level}</span><strong>{rate}</strong></div>
                      <p>of verified ad revenue</p>
                      <div className="referral-metrics">
                        <span><b>{count ?? '—'}</b> referrals</span>
                        <span><b>${Number(earnings ?? 0).toFixed(2)}</b> earned</span>
                      </div>
                    </article>
                  ))}
                </div>
                <p className="referral-disclaimer">Commissions are credited only after ad revenue is verified by the server. Referral rewards are not paid on deposits or package purchases.</p>
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
                <p className="preview-modal-note">This reward is allocated from the daily reward configured for your active package; the video itself does not generate revenue.</p>
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
                <button className="primary-button wide" onClick={() => openModal('deposit')}>Continue to deposit</button>
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
                    <p className="preview-modal-note">Send USDT on TRON (TRC20) only. Do not send other tokens. After sending, enter the transaction ID below.</p>
                  </div>
                  <label>TRON transaction ID
                    <input
                      type="text"
                      autoComplete="off"
                      minLength="64"
                      maxLength="64"
                      pattern="[A-Fa-f0-9]{64}"
                      value={depositTransactionId}
                      onChange={(event) => setDepositTransactionId(event.target.value)}
                      required
                    />
                  </label>
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
                {dataLoading ? (
                  <p className="preview-modal-note">Loading your available balance…</p>
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
                    <button className="primary-button wide" type="submit" disabled={!isSupabaseConfigured || withdrawalBusy || Number(withdrawalAmount) < 5 || Number(withdrawalAmount) > availableBalance}>
                      {withdrawalBusy ? 'Submitting…' : 'Submit withdrawal request'}
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
