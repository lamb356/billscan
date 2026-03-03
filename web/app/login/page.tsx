'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import Link from 'next/link';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: 'Error starting sign-in. Please try again.',
  OAuthCallback: 'Error completing sign-in. Please try again.',
  OAuthCreateAccount: 'Error creating your account. Please try again.',
  EmailCreateAccount: 'Error creating your account. Please try again.',
  Callback: 'Error during sign-in callback. Please try again.',
  OAuthAccountNotLinked: 'This email is already associated with another sign-in method.',
  AccessDenied: 'Access denied.',
  Verification: 'Verification link expired. Please sign in again.',
  Default: 'An error occurred. Please try again.',
};

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/audit';
  const errorParam = searchParams.get('error');
  const errorMsg = errorParam ? (ERROR_MESSAGES[errorParam] ?? ERROR_MESSAGES.Default) : null;
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  async function handleSignIn(provider: 'google' | 'github') {
    setLoadingProvider(provider);
    try { await signIn(provider, { callbackUrl }); } catch { setLoadingProvider(null); }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)', background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(16,185,129,0.06) 0%, transparent 60%)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'var(--text)' }}>
            <svg width="32" height="32" viewBox="0 0 28 28" fill="none">
              <rect x="4" y="2" width="16" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="20" cy="20" r="5.5" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="1.75" />
              <path d="M17.5 20 L19.2 21.7 L22.5 18.5" stroke="#10b981" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.03em' }}>Bill<span style={{ color: 'var(--accent)' }}>Scan</span></span>
          </Link>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-xl)', padding: '36px 32px', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <h1 style={{ fontSize: '1.375rem', marginBottom: 8 }}>Sign in to BillScan</h1>
            <p style={{ fontSize: '0.875rem', margin: 0 }}>Audit your medical bills in seconds.</p>
          </div>
          {errorMsg && (
            <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius)', padding: '12px 16px', fontSize: '0.875rem', color: '#f87171', marginBottom: 20 }}>{errorMsg}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => handleSignIn('google')} disabled={loadingProvider !== null} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '11px 20px', borderRadius: 'var(--radius)', border: '1px solid var(--border2)', background: 'var(--surface2)', color: 'var(--text)', fontSize: '0.9375rem', fontWeight: 500, fontFamily: 'var(--font)', cursor: loadingProvider ? 'not-allowed' : 'pointer', opacity: loadingProvider && loadingProvider !== 'google' ? 0.5 : 1, transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
              {loadingProvider === 'google' ? <div className="spinner" style={{ width: 18, height: 18 }} /> : <GoogleIcon />}
              Continue with Google
            </button>
            <button onClick={() => handleSignIn('github')} disabled={loadingProvider !== null} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '11px 20px', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.12)', background: '#24292e', color: '#ffffff', fontSize: '0.9375rem', fontWeight: 500, fontFamily: 'var(--font)', cursor: loadingProvider ? 'not-allowed' : 'pointer', opacity: loadingProvider && loadingProvider !== 'github' ? 0.5 : 1, transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
              {loadingProvider === 'github' ? <div className="spinner" style={{ width: 18, height: 18 }} /> : <GitHubIcon />}
              Continue with GitHub
            </button>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 24, paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 500 }}>Free</span><span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>3 bill audits per month</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: '0.8125rem', color: 'var(--green)', fontWeight: 600 }}>Pro · $9.99/mo</span><span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Unlimited audits + dispute tools</span></div>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: '0.8125rem', color: 'var(--text-faint)' }}>
          By signing in, you agree to our terms. {' '}<Link href="/" style={{ color: 'var(--text-muted)' }}>Back to home</Link>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></main>}>
      <LoginContent />
    </Suspense>
  );
}
