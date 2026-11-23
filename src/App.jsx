import { useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'

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
  const [referralCode, setReferralCode] = useState(() => new URLSearchParams(window.location.search).get('ref') || '')

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
      const result = mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              data: {
                display_name: displayName,
                ...(submittedReferralCode ? { referral_code: submittedReferralCode } : {}),
              },
            },
          })

      if (result.error) {
        setError(result.error.message)
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
        <p className="auth-description">Your account is secured and managed by Supabase Auth.</p>
        {message && <p className="auth-error" role="alert">{message}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        <form onSubmit={handleSubmit}>
          {mode === 'sign-up' && (
            <label>Name<input name="name" type="text" autoComplete="name" maxLength="80" required /></label>
          )}
          {mode === 'sign-up' && (
            <label>Referral code (optional)
              <input
                name="referral_code"
                type="text"
                autoComplete="off"
                maxLength="12"
                value={referralCode}
                onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
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
  const [modal, setModal] = useState(null)
  const [selectedPlan, setSelectedPlan] = useState(plans[2])
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

  const openModal = (type) => setModal(type)

  async function handleSignOut() {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) setAppError(error.message)
    } catch (requestError) {
      setAppError(requestError instanceof Error ? requestError.message : 'Sign out failed.')
    }
  }

  useEffect(() => {
    if (!supabase) return undefined

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthError('')
      setAuthLoading(false)
    })

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setAuthError(error.message)
      else setSession(data.session)
      setAuthLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

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

  async function copyReferralLink() {
    const referralUrl = `${window.location.origin}/?ref=${encodeURIComponent(referralCode)}`
    try {
      await navigator.clipboard.writeText(referralUrl)
      setReferralCopied(true)
      window.setTimeout(() => setReferralCopied(false), 2000)
    } catch (copyError) {
      setReferralError(copyError instanceof Error ? copyError.message : 'Could not copy the referral link.')
    }
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
            <p className="eyebrow">Monday, 23 November</p>
            <h1>{active}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications"><Icon name="bell" /><span className="notification-dot" /></button>
            <button className="avatar" aria-label="Open profile">JD</button>
          </div>
        </header>

        {active === 'Overview' && (
          <>
            <section className="balance-card">
              <div className="balance-main">
                <p>Total balance</p>
                <div className="balance-row">
                  <h2>$0.00</h2>
                </div>
                <div className="balance-actions">
                  <button className="primary-button" onClick={() => openModal('deposit')}><Icon name="down" size={17} />Deposit</button>
                  <button className="secondary-button" onClick={() => openModal('withdraw')}><Icon name="up" size={17} />Withdraw</button>
                </div>
              </div>
              <div className="earnings">
                <div className="earnings-head"><span>Today's earnings</span><strong>$0.00</strong></div>
                <div className="progress-track"><div className="progress-fill" style={{ width: '0%' }} /></div>
                <p><b>0 of 0</b> tasks completed</p>
              </div>
            </section>

            <section className="section-heading">
              <div><p className="eyebrow">Today</p><h2>Task list</h2></div>
              <button className="text-button" onClick={() => setActive('Activity')}>View activity <Icon name="arrow" size={16} /></button>
            </section>

            <section className="task-grid">
              {[0, 1, 2, 3, 4].map((task) => (
                <article className="task-card" key={task}>
                  <div className="task-icon">{String(task + 1).padStart(2, '0')}</div>
                  <div className="task-info">
                    <h3>Task unavailable</h3>
                    <p>Tasks will appear after setup</p>
                  </div>
                  <div className="task-reward">
                    <strong>—</strong>
                    <button disabled>Coming soon</button>
                  </div>
                </article>
              ))}
            </section>

            <section className="section-heading package-heading">
              <div><p className="eyebrow">Increase your earnings</p><h2>Packages</h2></div>
              <button className="text-button" onClick={() => setActive('Packages')}>View all <Icon name="arrow" size={16} /></button>
            </section>

            <section className="package-strip">
              {plans.slice(0, 4).map((plan) => (
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
                {plans.map((plan) => (
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
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close">×</button>
            {modal === 'choose' ? (
              <>
                <p className="eyebrow">Selected package</p>
                <h2 id="modal-title">${selectedPlan.amount} package</h2>
                <div className="modal-summary"><span>{selectedPlan.tasks} daily tasks</span><span>${selectedPlan.daily} daily earnings</span><span>365 day term</span></div>
                <button className="primary-button wide" onClick={() => setModal('deposit')}>Continue to deposit</button>
              </>
            ) : (
              <>
                <p className="eyebrow">{modal === 'deposit' ? 'Add funds' : 'Cash out'}</p>
                <h2 id="modal-title">{modal === 'deposit' ? 'Deposit crypto' : 'Withdraw crypto'}</h2>
                <label>Amount (USD)<input type="number" defaultValue={modal === 'deposit' ? selectedPlan.amount : 50} min="5" /></label>
                <label>Cryptocurrency
                  <select defaultValue="USDT"><option value="USDT">USDT</option></select>
                </label>
                <label>Network
                  <select defaultValue="TRC20">
                    <option value="TRC20">TRC20</option>
                    <option value="BEP20">BNB (BEP20)</option>
                  </select>
                </label>
                {!isSupabaseConfigured && <p className="preview-modal-note">Connect Supabase to enable account features. Crypto payments are not configured, so no funds will be accepted.</p>}
                <button className="primary-button wide" onClick={() => setModal(null)} disabled={!isSupabaseConfigured}>{modal === 'deposit' ? 'Generate payment address' : 'Continue'}</button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default App
