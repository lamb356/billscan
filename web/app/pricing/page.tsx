import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Pricing',
  description: '93% of ER bills have overcharges. BillScan — free tier for individuals, Pro for serious disputes.',
};

function FeatureRow({ feature, free, pro }: { feature: string; free: string | boolean; pro: string | boolean }) {
  const renderVal = (v: string | boolean, isPro: boolean) => {
    if (v === true) return <span style={{ color: isPro ? 'var(--green)' : 'var(--text-muted)' }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="Included"><circle cx="8" cy="8" r="7" fill={isPro ? 'var(--green-dim)' : 'rgba(255,255,255,0.04)'} stroke={isPro ? 'rgba(16,185,129,0.3)' : 'var(--border)'} /><path d="M5 8 L7 10 L11 6" stroke={isPro ? 'var(--green)' : 'var(--text-muted)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
    if (v === false) return <span style={{ color: 'var(--text-faint)' }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="Not included"><circle cx="8" cy="8" r="7" stroke="var(--border)" /><path d="M10 6 L6 10 M6 6 L10 10" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" /></svg></span>;
    return <span style={{ fontSize: '0.875rem', color: isPro ? 'var(--text)' : 'var(--text-muted)' }}>{v as string}</span>;
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', gap: 16, padding: '13px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
      <span style={{ fontSize: '0.9375rem', color: 'var(--text)' }}>{feature}</span>
      <div style={{ textAlign: 'center' }}>{renderVal(free, false)}</div>
      <div style={{ textAlign: 'center' }}>{renderVal(pro, true)}</div>
    </div>
  );
}

const FEATURES = [
  { feature: 'Audits per month', free: '3', pro: 'Unlimited' },
  { feature: 'CMS rate comparison', free: true, pro: true },
  { feature: 'Overcharge severity scoring', free: true, pro: true },
  { feature: 'Charity care check', free: true, pro: true },
  { feature: 'All 4 CMS fee schedules', free: true, pro: true },
  { feature: 'ZIP-to-locality matching', free: true, pro: true },
  { feature: 'EOB comparison', free: false, pro: true },
  { feature: 'Dispute letter (PDF)', free: false, pro: true },
  { feature: 'Phone script', free: false, pro: true },
  { feature: 'Geographic rate matching', free: false, pro: true },
  { feature: 'Shareable report links', free: false, pro: true },
  { feature: 'Priority support', free: false, pro: true },
] as const;

export default function PricingPage() {
  return (
    <>
      <nav className="nav"><div className="nav-inner">
        <Link href="/" className="nav-logo"><svg width="20" height="20" viewBox="0 0 28 28" fill="none"><rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><circle cx="20" cy="20" r="5.5" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="1.75"/><path d="M17.5 20L19.2 21.7L22.5 18.5" stroke="#10b981" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></svg>Bill<span>Scan</span></Link>
        <div className="nav-links"><Link href="/audit" className="nav-link">Audit</Link><Link href="/audit" className="btn btn-primary" style={{ padding: '7px 16px', fontSize: '0.875rem' }}>Get Started</Link></div>
      </div></nav>
      <main style={{ padding: 'var(--space-20) 0' }}>
        <div className="container" style={{ maxWidth: 860 }}>
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-16)' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 99, padding: '5px 14px', fontSize: '0.8125rem', color: 'var(--red)', marginBottom: 20, fontWeight: 500 }}>93% of ER bills contain overcharges</div>
            <h1 style={{ marginBottom: 16 }}>Simple, honest pricing</h1>
            <p style={{ fontSize: '1.0625rem', maxWidth: 520, margin: '0 auto' }}>Start for free. Upgrade when you need dispute letters and phone scripts.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 48 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '32px' }}>
              <div style={{ marginBottom: 24 }}><div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Free</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}><span style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.04em' }}>$0</span><span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>/month</span></div><p style={{ fontSize: '0.875rem', margin: 0 }}>Perfect for checking a single bill or verifying a charge.</p></div>
              <Link href="/audit" className="btn btn-secondary" style={{ width: '100%', marginBottom: 24, justifyContent: 'center' }}>Start for free</Link>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{['3 audits per month','CMS rate comparison','Overcharge detection','Charity care check','All 4 CMS fee schedules','ZIP-to-locality matching'].map((item) => (<div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.875rem' }}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6.5" stroke="var(--border2)" /><path d="M4.5 7 L6 8.5 L9.5 5.5" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>{item}</div>))}</div>
            </div>
            <div style={{ background: 'var(--surface)', border: '2px solid rgba(16,185,129,0.4)', borderRadius: 'var(--radius-xl)', padding: '32px', position: 'relative', boxShadow: '0 0 40px rgba(16,185,129,0.08)' }}>
              <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: '#fff', fontSize: '0.75rem', fontWeight: 700, padding: '4px 14px', borderRadius: 99, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Most Popular</div>
              <div style={{ marginBottom: 24 }}><div style={{ fontSize: '0.8125rem', color: 'var(--green)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Pro</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}><span style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.04em' }}>$9.99</span><span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>/month</span></div><p style={{ fontSize: '0.875rem', margin: 0 }}>For patients ready to dispute. Everything in Free, plus dispute tools.</p></div>
              <Link href="/api/stripe/checkout" className="btn btn-primary" style={{ width: '100%', marginBottom: 24, justifyContent: 'center' }}>Upgrade to Pro</Link>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{[{text:'Unlimited audits',h:true},{text:'Everything in Free',h:false},{text:'EOB comparison',h:false},{text:'Dispute letter (ready to send)',h:true},{text:'Phone script for billing dept.',h:true},{text:'Geographic rate matching',h:false},{text:'Shareable report links',h:false},{text:'Priority support',h:false}].map((item) => (<div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.875rem' }}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6.5" fill="rgba(16,185,129,0.12)" stroke="rgba(16,185,129,0.3)" /><path d="M4.5 7 L6 8.5 L9.5 5.5" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span style={{ color: item.h ? 'var(--text)' : 'var(--text-muted)', fontWeight: item.h ? 500 : 400 }}>{item.text}</span></div>))}</div>
            </div>
          </div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: '32px', marginBottom: 48 }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: 20 }}>Full comparison</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', gap: 16, marginBottom: 8 }}><div /><div style={{ textAlign: 'center', fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Free</div><div style={{ textAlign: 'center', fontSize: '0.8125rem', color: 'var(--green)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pro</div></div>
            {FEATURES.map((f) => <FeatureRow key={f.feature} {...f} />)}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', gap: 16, paddingTop: 20 }}><div /><div style={{ textAlign: 'center' }}><Link href="/audit" className="btn btn-sm btn-secondary">Start free</Link></div><div style={{ textAlign: 'center' }}><Link href="/api/stripe/checkout" className="btn btn-sm btn-primary">Get Pro</Link></div></div>
          </div>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: 24, textAlign: 'center' }}>Frequently asked questions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {[{q:'What does "potential savings" mean?',a:'It\'s the difference between what you were billed and the official Medicare rate for the same procedure. It\'s not a guarantee — hospitals can charge more than Medicare — but it gives you an objective baseline to dispute from.'},{q:'Is this legal or medical advice?',a:'No. BillScan is an informational tool that shows you publicly available government rate data. Always consult a professional for legal or medical advice.'},{q:'Where does the rate data come from?',a:'Directly from CMS.gov — the Centers for Medicare & Medicaid Services. We use the Physician Fee Schedule (PFS), Clinical Lab Fee Schedule (CLFS), ASP Drug Pricing, and Hospital OPPS rates.'},{q:'Can I cancel Pro at any time?',a:'Yes. You can cancel through the customer portal at any time. You\'ll keep Pro access until the end of your billing period.'}].map((item) => (<div key={item.q} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9375rem' }}>{item.q}</div><p style={{ fontSize: '0.875rem', margin: 0 }}>{item.a}</p></div>))}
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 64, padding: '48px 32px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
            <h2 style={{ marginBottom: 16 }}>Start with a free audit</h2>
            <p style={{ marginBottom: 28, maxWidth: 420, margin: '0 auto 28px' }}>No credit card needed. 3 free audits per month. Upgrade when you&apos;re ready to dispute.</p>
            <Link href="/audit" className="btn btn-primary btn-lg">Upload Your Bill</Link>
          </div>
        </div>
      </main>
    </>
  );
}
