import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'BillScan — Your Medical Bills Are Probably Wrong',
  description: 'BillScan audits your medical bills against 1,057,383 CMS Medicare rates. Find overcharges instantly. Free to start.',
};

function BillScanLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-label="BillScan logo">
      <rect x="4" y="2" width="16" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 2 L20 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16 2 L16 6 L20 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <line x1="7" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="13.5" x2="16" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="17" x2="12" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="20" cy="20" r="5.5" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="1.75" />
      <path d="M17.5 20 L19.2 21.7 L22.5 18.5" stroke="#10b981" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: '1.625rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: 'var(--radius)', background: 'var(--green-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0, marginTop: 2 }}>{icon}</div>
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{desc}</div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <Link href="/" className="nav-logo"><BillScanLogo size={22} />Bill<span>Scan</span></Link>
          <div className="nav-links">
            <Link href="/pricing" className="nav-link">Pricing</Link>
            <Link href="/audit" className="btn btn-primary" style={{ padding: '7px 16px', fontSize: '0.875rem' }}>Start Free Audit</Link>
          </div>
        </div>
      </nav>

      <main>
        <section style={{ padding: 'var(--space-20) 0 var(--space-16)', borderBottom: '1px solid var(--border)', background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(16,185,129,0.08) 0%, transparent 70%)' }}>
          <div className="container" style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--green-dim)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 99, padding: '5px 14px', fontSize: '0.8125rem', color: 'var(--green)', marginBottom: 28, fontWeight: 500 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5" /></svg>
              Open source · Based on real CMS.gov data
            </div>
            <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.25rem)', fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.1, marginBottom: 24, color: 'var(--text)' }}>
              Your medical bills<br />
              <span style={{ color: 'var(--red)' }}>are probably wrong.</span><br />
              <span style={{ color: 'var(--green)' }}>We&apos;ll prove it.</span>
            </h1>
            <p style={{ fontSize: '1.0625rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 36, maxWidth: 560, margin: '0 auto 36px' }}>
              BillScan compares every line of your hospital bill against official Medicare fee schedules.
              Upload your bill, get a full overcharge report in seconds — backed by 1M+ government rates.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 48 }}>
              <Link href="/audit" className="btn btn-primary btn-lg">Start Free Audit</Link>
              <Link href="/pricing" className="btn btn-secondary btn-lg">View Pricing</Link>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-xl)', padding: '24px 32px', display: 'inline-flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', justifyContent: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Billed</div>
                <div style={{ fontSize: '1.625rem', fontWeight: 700, color: 'var(--red)', letterSpacing: '-0.03em', textDecoration: 'line-through', opacity: 0.8 }}>$13,184</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <svg width="40" height="16" viewBox="0 0 40 16" fill="none"><path d="M0 8 L32 8 M28 2 L36 8 L28 14" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>CMS Rate</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Fair Price</div>
                <div style={{ fontSize: '1.625rem', fontWeight: 700, color: 'var(--green)', letterSpacing: '-0.03em' }}>$913</div>
              </div>
              <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 'var(--radius)', padding: '10px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--green)', marginBottom: 2, fontWeight: 500 }}>You save</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--green)', letterSpacing: '-0.03em' }}>$12,271</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>14.4× overcharged</div>
              </div>
            </div>
          </div>
        </section>

        <section style={{ padding: 'var(--space-16) 0', borderBottom: '1px solid var(--border)' }}>
          <div className="container">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
              <StatCard value="1,057,383" label="CMS fee schedule rates" />
              <StatCard value="4" label="CMS fee schedules (PFS, CLFS, ASP, OPPS)" />
              <StatCard value="42,956" label="ZIP codes with locality matching" />
              <StatCard value="143" label="Automated audit tests" />
              <StatCard value="93%" label="ER bills with overcharges" />
            </div>
          </div>
        </section>

        <section style={{ padding: 'var(--space-20) 0', borderBottom: '1px solid var(--border)' }}>
          <div className="container" style={{ maxWidth: 860 }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-12)' }}>
              <h2>How it works</h2>
              <p style={{ marginTop: 12, maxWidth: 520, margin: '12px auto 0' }}>Three steps from confused patient to armed negotiator.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-6)' }}>
              {[{ step: '01', title: 'Upload your bill', desc: 'Upload your itemized hospital bill as a PDF, image, or JSON. We support EOBs too.' }, { step: '02', title: 'We compare every line', desc: 'Each CPT code is matched against the official CMS fee schedules for your region.' }, { step: '03', title: 'Get your overcharge report', desc: 'See exactly which charges are inflated, by how much, and how strong your dispute case is.' }].map((item) => (
                <div key={item.step} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-6)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 12, fontFamily: 'var(--font-mono)' }}>{item.step}</div>
                  <h3 style={{ fontSize: '1rem', marginBottom: 8 }}>{item.title}</h3>
                  <p style={{ fontSize: '0.875rem', margin: 0 }}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{ padding: 'var(--space-20) 0', borderBottom: '1px solid var(--border)' }}>
          <div className="container" style={{ maxWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 'var(--space-8)' }}>
              <div>
                <h2 style={{ marginBottom: 32 }}>Built on real government data</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                  <Feature icon="📋" title="CMS Physician Fee Schedule" desc="Every CPT code Medicare pays for, updated annually. The ground truth for what procedures actually cost." />
                  <Feature icon="🏥" title="OPPS Hospital Outpatient Rates" desc="What Medicare pays hospitals for outpatient services — not what they bill." />
                  <Feature icon="💊" title="ASP Drug Pricing + CLFS Lab Fees" desc="Average sales price for drugs, clinical laboratory fee schedule — all four data sources, cross-referenced." />
                  <Feature icon="📍" title="ZIP-to-locality matching" desc="Rates vary by region. We map your ZIP to the correct Medicare locality for accurate comparison." />
                </div>
              </div>
              <div>
                <h2 style={{ marginBottom: 32 }}>Actionable results</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                  <Feature icon="⚡" title="Severity scoring" desc="Every finding is classified as low, medium, high, or extreme — so you know what to dispute first." />
                  <Feature icon="📄" title="Dispute letter generation" desc="Pro users get a ready-to-send dispute letter citing specific CMS codes and overcharge amounts." />
                  <Feature icon="📞" title="Phone script for billing department" desc="Exactly what to say when you call, with the right terminology to sound like you know your rights." />
                  <Feature icon="🆓" title="Charity care checker" desc="Many hospitals must provide financial assistance. We check if you qualify based on your state and income." />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section style={{ padding: 'var(--space-20) 0', textAlign: 'center', background: 'radial-gradient(ellipse 60% 60% at 50% 100%, rgba(16,185,129,0.07) 0%, transparent 70%)' }}>
          <div className="container" style={{ maxWidth: 600 }}>
            <h2 style={{ marginBottom: 16 }}>Start auditing for free</h2>
            <p style={{ marginBottom: 36 }}>3 free audits per month. No credit card required. Pro users get unlimited audits, dispute letters, and phone scripts.</p>
            <Link href="/audit" className="btn btn-primary btn-lg">Upload Your Bill</Link>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '1px solid var(--border)', padding: 'var(--space-6) 0', background: 'var(--surface)' }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32, flexWrap: 'wrap', fontSize: '0.8125rem', color: 'var(--text-faint)' }}>
          <span>Based on real CMS.gov data</span>
          <span style={{ color: 'var(--border2)' }}>|</span>
          <span>143 automated tests</span>
          <span style={{ color: 'var(--border2)' }}>|</span>
          <span>Open source</span>
          <span style={{ color: 'var(--border2)' }}>|</span>
          <span>Not legal or medical advice</span>
        </div>
      </footer>
    </>
  );
}
