'use client';

import { useSession, signOut } from 'next-auth/react';
import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { AuditReport } from '../../../src/schema/report';
import type { AuditFinding } from '../../../src/schema/finding';

interface AuditResponse { report: AuditReport; isPro: boolean; disputeLetter?: string; phoneScript?: string; }
interface SessionUser { name?: string | null; email?: string | null; image?: string | null; id?: string; plan?: string; auditCount?: number; auditResetAt?: string; }

const FREE_TIER_LIMIT = 3;

function severityColor(s: string | null) { switch(s) { case 'extreme': return 'var(--red)'; case 'high': return 'var(--orange)'; case 'medium': return 'var(--yellow)'; case 'low': return 'var(--green)'; default: return 'var(--text-muted)'; } }
function severityBg(s: string | null) { switch(s) { case 'extreme': return 'var(--red-dim)'; case 'high': return 'var(--orange-dim)'; case 'medium': return 'var(--yellow-dim)'; case 'low': return 'var(--green-dim)'; default: return 'var(--surface2)'; } }
function formatDollar(n: number | null) { if (n === null) return 'N/A'; return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
function matchLabel(mode: string) { const l: Record<string,string> = { exact_code_modifier_locality: 'Exact+loc', exact_code_modifier: 'Exact+mod', exact_code_only: 'Exact', unmatched: 'No match' }; return l[mode] ?? mode; }
function sourceLabel(s: string | null | undefined) { const l: Record<string,string> = { pfs: 'PFS', clfs: 'CLFS', asp: 'ASP', opps: 'OPPS' }; return s ? (l[s] ?? s.toUpperCase()) : '—'; }

function Nav({ user }: { user: SessionUser }) {
  return (
    <nav className="nav"><div className="nav-inner">
      <Link href="/" className="nav-logo">
        <svg width="20" height="20" viewBox="0 0 28 28" fill="none"><rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><circle cx="20" cy="20" r="5.5" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="1.75"/><path d="M17.5 20L19.2 21.7L22.5 18.5" stroke="#10b981" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Bill<span>Scan</span>
      </Link>
      <div className="nav-links" style={{ gap: 8 }}>
        {user.plan === 'pro' ? <span className="badge badge-pro">Pro</span> : <Link href="/pricing" className="btn btn-sm btn-secondary">Upgrade to Pro</Link>}
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', padding: '0 4px' }}>{user.email}</span>
        <button onClick={() => signOut({ callbackUrl: '/' })} className="btn btn-sm btn-ghost">Sign out</button>
      </div>
    </div></nav>
  );
}

function UploadArea({ onFile, loading }: { onFile: (file: File) => void; loading: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }, [onFile]);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onFile(f); };
  return (
    <div onClick={() => !loading && inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} style={{ border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 'var(--radius-xl)', padding: '48px 32px', textAlign: 'center', cursor: loading ? 'not-allowed' : 'pointer', background: dragging ? 'var(--green-dim)' : 'var(--surface)', transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)', opacity: loading ? 0.7 : 1 }}>
      <input ref={inputRef} type="file" accept=".json,.pdf,.jpg,.jpeg,.png" onChange={handleChange} style={{ display: 'none' }} disabled={loading} />
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}><div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /><div style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>Analyzing your bill against CMS rates…</div></div>
      ) : (
        <><div style={{ fontSize: 40, marginBottom: 16 }}>📋</div><div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>Drop your medical bill here</div><div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 16 }}>or click to browse</div><div style={{ fontSize: '0.8125rem', color: 'var(--text-faint)' }}>Accepts .json, .pdf, .jpg, .png — itemized hospital bills & EOBs</div></>
      )}
    </div>
  );
}

function UsageBar({ used, limit, isPro }: { used: number; limit: number; isPro: boolean }) {
  if (isPro) return null;
  const pct = Math.min((used / limit) * 100, 100);
  const atLimit = used >= limit;
  return (
    <div style={{ background: atLimit ? 'var(--red-dim)' : 'var(--surface)', border: `1px solid ${atLimit ? 'rgba(239,68,68,0.25)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 6 }}>Free tier usage this month</div>
        <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 99, overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: atLimit ? 'var(--red)' : 'var(--accent)', borderRadius: 99, transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)' }} /></div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: atLimit ? 'var(--red)' : 'var(--text)' }}>{used} of {limit} audits</div>
        {atLimit && <Link href="/pricing" className="btn btn-sm btn-primary" style={{ marginTop: 8 }}>Upgrade to Pro</Link>}
      </div>
    </div>
  );
}

function FindingsTable({ findings }: { findings: AuditFinding[] }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>#</th><th>CPT Code</th><th>Description</th><th style={{ textAlign: 'right' }}>Billed</th><th style={{ textAlign: 'right' }}>CMS Rate</th><th style={{ textAlign: 'right' }}>Overcharge</th><th>Severity</th><th>Source</th><th>Match</th></tr></thead>
      <tbody>{findings.map((f) => (
        <tr key={f.lineNumber}>
          <td style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{f.lineNumber}</td>
          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f.cptCode}</td>
          <td style={{ maxWidth: 260, color: 'var(--text)' }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.description}</div></td>
          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatDollar(f.billedAmount)}</td>
          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{formatDollar(f.cmsRateUsed)}</td>
          <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: f.overchargeAmount && f.overchargeAmount > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
            {f.overchargeAmount !== null && f.overchargeAmount > 0 ? formatDollar(f.overchargeAmount) : '—'}
            {f.overchargeMultiplier !== null && f.overchargeMultiplier > 1 && <span style={{ fontSize: '0.75rem', marginLeft: 4, opacity: 0.8 }}>{f.overchargeMultiplier}×</span>}
          </td>
          <td>{f.severity ? <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600, background: severityBg(f.severity), color: severityColor(f.severity), textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.severity}</span> : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
          <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{sourceLabel(f.rateSource)}</td>
          <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{matchLabel(f.matchMode)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function ReportSummary({ report, isPro, disputeLetter, phoneScript }: { report: AuditReport; isPro: boolean; disputeLetter?: string; phoneScript?: string }) {
  const [showDispute, setShowDispute] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const savings = report.totalPotentialSavings;
  const pctSavings = report.totalBilled > 0 ? ((savings / report.totalBilled) * 100).toFixed(1) : '0';
  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Billed</div><div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>{formatDollar(report.totalBilled)}</div></div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>CMS Baseline</div><div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>{formatDollar(report.totalCmsBaseline)}</div></div>
        <div style={{ background: savings > 0 ? 'var(--green-dim)' : 'var(--surface)', border: `1px solid ${savings > 0 ? 'rgba(16,185,129,0.25)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontSize: '0.75rem', color: savings > 0 ? 'var(--green)' : 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Potential Savings</div><div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: savings > 0 ? 'var(--green)' : 'var(--text)' }}>{formatDollar(savings)}</div>{savings > 0 && <div style={{ fontSize: '0.8125rem', color: 'var(--green)', marginTop: 4 }}>{pctSavings}% of billed amount</div>}</div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Findings</div><div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>{report.matchedLineCount} <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>matched</span></div><div style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', marginTop: 4 }}>{report.unmatchedLineCount} unmatched · avg {report.summary.averageMultiplier ?? '—'}× markup</div></div>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
        <div><span style={{ color: 'var(--text-muted)' }}>Facility: </span><span style={{ fontWeight: 600 }}>{report.facilityName || 'Unknown'}</span><span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>({report.facilityType})</span></div>
        <div><span style={{ color: 'var(--text-muted)' }}>CMS Year: </span><span>{report.stamp.cmsEffectiveYear}</span><span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>[{report.stamp.dataSources?.join('+') ?? 'PFS'}]</span></div>
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>ID: {report.stamp.reportId.slice(0, 8)}…</div>
      </div>
      {report.summary.topOvercharges.length > 0 && (
        <div><h3 style={{ fontSize: '0.9375rem', marginBottom: 12 }}>Top Overcharges</h3><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{report.summary.topOvercharges.map((item, i) => (<div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}><div><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, marginRight: 10 }}>{item.cptCode}</span><span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{item.description}</span></div><div style={{ display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0 }}><span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>{formatDollar(item.billedAmount)}</span><span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>→</span><span style={{ fontSize: '0.875rem', color: 'var(--green)' }}>{formatDollar(item.cmsRate)}</span><span style={{ fontWeight: 700, color: 'var(--red)' }}>save {formatDollar(item.savings)}</span></div></div>))}</div></div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {isPro ? (
          <>{disputeLetter && <button onClick={() => setShowDispute(!showDispute)} className="btn btn-secondary">{showDispute ? 'Hide' : 'View'} Dispute Letter</button>}{phoneScript && <button onClick={() => setShowScript(!showScript)} className="btn btn-secondary">{showScript ? 'Hide' : 'View'} Phone Script</button>}</>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, width: '100%', flexWrap: 'wrap' }}>
            <div><div style={{ fontWeight: 600, marginBottom: 4 }}>Dispute letter + phone script available on Pro</div><div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Get a ready-to-send dispute letter and a phone script to call the billing department.</div></div>
            <Link href="/pricing" className="btn btn-primary">Upgrade to Pro · $9.99/mo</Link>
          </div>
        )}
      </div>
      {showDispute && disputeLetter && <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-lg)', padding: 24 }}><h3 style={{ fontSize: '0.9375rem', marginBottom: 12 }}>Dispute Letter</h3><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{disputeLetter}</pre></div>}
      {showScript && phoneScript && <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-lg)', padding: 24 }}><h3 style={{ fontSize: '0.9375rem', marginBottom: 12 }}>Phone Script</h3><pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{phoneScript}</pre></div>}
      <div><h3 style={{ fontSize: '0.9375rem', marginBottom: 12 }}>All Line Items ({report.findings.length})</h3><FindingsTable findings={report.findings} /></div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border)', paddingTop: 16, lineHeight: 1.8 }}>
        <div>Report ID: {report.stamp.reportId}</div><div>Generated: {report.stamp.generatedAt}</div><div>Input hash: {report.stamp.inputHash}</div><div>CMS data hash: {report.stamp.cmsDataHash.slice(0, 32)}…</div><div>Tool version: {report.stamp.toolVersion}</div>
      </div>
    </div>
  );
}

export default function AuditPage() {
  const { data: session } = useSession();
  const user = session?.user as SessionUser | undefined;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResponse | null>(null);
  const auditCount = user?.auditCount ?? 0;
  const isPro = user?.plan === 'pro';
  const atLimit = !isPro && auditCount >= FREE_TIER_LIMIT;

  async function handleFile(file: File) {
    if (atLimit) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/audit', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  if (!user) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>;

  return (
    <><Nav user={user} />
      <main style={{ padding: 'var(--space-10) 0 var(--space-20)' }}>
        <div className="container" style={{ maxWidth: 1000 }}>
          <div style={{ marginBottom: 32 }}><h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Audit Your Bill</h1><p style={{ fontSize: '0.9375rem', margin: 0 }}>Upload an itemized medical bill to compare against CMS Medicare rates.</p></div>
          {!isPro && <div style={{ marginBottom: 24 }}><UsageBar used={auditCount} limit={FREE_TIER_LIMIT} isPro={isPro} /></div>}
          {!atLimit && <div style={{ marginBottom: 32 }}><UploadArea onFile={handleFile} loading={loading} /></div>}
          {atLimit && !result && <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-xl)', padding: '48px 32px', textAlign: 'center' }}><div style={{ fontSize: '2rem', marginBottom: 16 }}>🔒</div><h2 style={{ fontSize: '1.25rem', marginBottom: 12 }}>Monthly limit reached</h2><p style={{ marginBottom: 28, maxWidth: 400, margin: '0 auto 28px' }}>You&apos;ve used all {FREE_TIER_LIMIT} free audits this month. Upgrade to Pro for unlimited audits.</p><Link href="/pricing" className="btn btn-primary btn-lg">Upgrade to Pro · $9.99/mo</Link></div>}
          {error && <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-lg)', padding: '16px 20px', color: '#f87171', marginBottom: 24, fontSize: '0.9375rem' }}><strong>Error:</strong> {error}</div>}
          {result && <ReportSummary report={result.report} isPro={result.isPro} disputeLetter={result.disputeLetter} phoneScript={result.phoneScript} />}
          {!result && !loading && !error && !atLimit && <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.875rem', marginTop: 16 }}>Supported formats: itemized hospital bills as PDF, photo, or JSON</div>}
        </div>
      </main>
    </>
  );
}
