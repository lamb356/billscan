import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDb } from '../../../../src/db/connection';
import type { AuditReport } from '../../../../src/schema/report';
import type { AuditFinding } from '../../../../src/schema/finding';

interface ReportPageProps { params: { id: string }; }
interface DbAuditRow { report_id: string; report_json: string; created_at: string; }

async function getReport(id: string): Promise<AuditReport | null> {
  try {
    const db = getDb();
    const result = await db.execute({ sql: 'SELECT report_id, report_json, created_at FROM audits WHERE report_id = ? LIMIT 1', args: [id] });
    const row = result.rows[0] as DbAuditRow | undefined;
    if (!row) return null;
    return JSON.parse(row.report_json) as AuditReport;
  } catch { return null; }
}

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const report = await getReport(params.id);
  if (!report) return { title: 'Report Not Found' };
  const savings = report.totalPotentialSavings;
  const facilityName = report.facilityName || 'Unknown facility';
  const description = savings > 0 ? `BillScan found $${savings.toLocaleString()} in potential overcharges at ${facilityName}. ${report.matchedLineCount} line items compared against CMS Medicare rates.` : `BillScan audit for ${facilityName}. ${report.matchedLineCount} line items compared against CMS rates.`;
  const title = savings > 0 ? `$${savings.toLocaleString()} in Overcharges Found — BillScan Report` : `BillScan Audit Report — ${facilityName}`;
  return { title, description, openGraph: { title, description, type: 'website' }, twitter: { card: 'summary', title, description } };
}

function formatDollar(n: number | null) { if (n === null) return 'N/A'; return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
function severityColor(s: string | null) { switch(s) { case 'extreme': return 'var(--red)'; case 'high': return 'var(--orange)'; case 'medium': return 'var(--yellow)'; case 'low': return 'var(--green)'; default: return 'var(--text-muted)'; } }
function severityBg(s: string | null) { switch(s) { case 'extreme': return 'rgba(239,68,68,0.15)'; case 'high': return 'rgba(249,115,22,0.15)'; case 'medium': return 'rgba(245,158,11,0.15)'; case 'low': return 'rgba(16,185,129,0.12)'; default: return 'var(--surface2)'; } }
function matchLabel(mode: string) { const l: Record<string,string> = { exact_code_modifier_locality: 'Exact+loc', exact_code_modifier: 'Exact+mod', exact_code_only: 'Exact', unmatched: 'No match' }; return l[mode] ?? mode; }
function sourceLabel(s: string | null | undefined) { const l: Record<string,string> = { pfs: 'PFS', clfs: 'CLFS', asp: 'ASP', opps: 'OPPS' }; return s ? (l[s] ?? s.toUpperCase()) : '—'; }

function FindingRow({ f }: { f: AuditFinding }) {
  const hasOvercharge = f.overchargeAmount !== null && f.overchargeAmount > 0;
  return (
    <tr>
      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', fontSize: '0.8125rem' }}>{f.lineNumber}</td>
      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{f.cptCode}</td>
      <td style={{ maxWidth: 280, color: 'var(--text)' }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.875rem' }}>{f.description}</div></td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>{formatDollar(f.billedAmount)}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-muted)' }}>{formatDollar(f.cmsRateUsed)}</td>
      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.875rem', fontWeight: hasOvercharge ? 600 : 400, color: hasOvercharge ? 'var(--red)' : 'var(--text-faint)' }}>{hasOvercharge ? formatDollar(f.overchargeAmount) : '—'}{f.overchargeMultiplier && f.overchargeMultiplier > 1 && <span style={{ fontSize: '0.75rem', marginLeft: 4, opacity: 0.75 }}>{f.overchargeMultiplier}×</span>}</td>
      <td>{f.severity ? <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, background: severityBg(f.severity), color: severityColor(f.severity), textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.severity}</span> : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{sourceLabel(f.rateSource)}</td>
      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{matchLabel(f.matchMode)}</td>
    </tr>
  );
}

export default async function ReportPage({ params }: ReportPageProps) {
  const report = await getReport(params.id);
  if (!report) notFound();
  const savings = report.totalPotentialSavings;
  const pctSavings = report.totalBilled > 0 ? ((savings / report.totalBilled) * 100).toFixed(1) : '0';
  const sources = report.stamp.dataSources?.join('+') ?? 'PFS';
  return (
    <>
      <nav className="nav"><div className="nav-inner">
        <Link href="/" className="nav-logo"><svg width="20" height="20" viewBox="0 0 28 28" fill="none"><rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/><circle cx="20" cy="20" r="5.5" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="1.75"/><path d="M17.5 20L19.2 21.7L22.5 18.5" stroke="#10b981" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></svg>Bill<span>Scan</span></Link>
        <div className="nav-links"><Link href="/audit" className="btn btn-primary" style={{ padding: '7px 16px', fontSize: '0.875rem' }}>Audit Your Bill</Link></div>
      </div></nav>
      <main style={{ padding: 'var(--space-10) 0 var(--space-20)' }}>
        <div className="container" style={{ maxWidth: 1000 }}>
          <div style={{ marginBottom: 32 }}><div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 8 }}>BillScan Audit Report</div><h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>{report.facilityName ? `${report.facilityName} Bill Audit` : 'Medical Bill Audit'}</h1><div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{report.facilityType} ·{' '}{new Date(report.stamp.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} ·{' '}CMS {report.stamp.cmsEffectiveYear} [{sources}]</div></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Billed</div><div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{formatDollar(report.totalBilled)}</div></div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>CMS Baseline</div><div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{formatDollar(report.totalCmsBaseline)}</div></div>
            <div style={{ background: savings > 0 ? 'var(--green-dim)' : 'var(--surface)', border: `1px solid ${savings > 0 ? 'rgba(16,185,129,0.25)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontSize: '0.75rem', color: savings > 0 ? 'var(--green)' : 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Potential Savings</div><div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em', color: savings > 0 ? 'var(--green)' : 'var(--text)' }}>{formatDollar(savings)}</div>{savings > 0 && <div style={{ fontSize: '0.8125rem', color: 'var(--green)', marginTop: 4 }}>{pctSavings}% of billed</div>}</div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Avg Markup</div><div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{report.summary.averageMultiplier ?? '—'}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>×</span></div><div style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', marginTop: 4 }}>{report.matchedLineCount} matched / {report.unmatchedLineCount} unmatched</div></div>
          </div>
          {report.summary.topOvercharges.length > 0 && (<div style={{ marginBottom: 32 }}><h2 style={{ fontSize: '1rem', marginBottom: 16 }}>Top Overcharges</h2><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{report.summary.topOvercharges.map((item, i) => (<div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}><div><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, marginRight: 10, fontSize: '0.875rem' }}>{item.cptCode}</span><span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{item.description}</span></div><div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}><span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>{formatDollar(item.billedAmount)}</span><span style={{ fontSize: '0.875rem', color: 'var(--green)' }}>CMS: {formatDollar(item.cmsRate)}</span><span style={{ fontWeight: 700, color: 'var(--red)', fontSize: '0.875rem' }}>save {formatDollar(item.savings)}</span></div></div>))}</div></div>)}
          <div style={{ marginBottom: 32 }}><h2 style={{ fontSize: '1rem', marginBottom: 16 }}>All Line Items ({report.findings.length})</h2><div className="table-wrap"><table><thead><tr><th>#</th><th>CPT</th><th>Description</th><th style={{ textAlign: 'right' }}>Billed</th><th style={{ textAlign: 'right' }}>CMS Rate</th><th style={{ textAlign: 'right' }}>Overcharge</th><th>Severity</th><th>Source</th><th>Match</th></tr></thead><tbody>{report.findings.map((f) => <FindingRow key={f.lineNumber} f={f} />)}</tbody></table></div></div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', lineHeight: 1.9, marginBottom: 32 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Transparency Stamp</div>
            <div>report_id: {report.stamp.reportId}</div><div>generated_at: {report.stamp.generatedAt}</div><div>tool_version: {report.stamp.toolVersion}</div><div>cms_effective_year: {report.stamp.cmsEffectiveYear}</div><div>cms_snapshot_id: {report.stamp.cmsSnapshotId}</div><div>cms_data_hash: {report.stamp.cmsDataHash}</div><div>input_hash: {report.stamp.inputHash}</div><div>hash_algorithm: {report.stamp.hashAlgorithm}</div><div>data_sources: [{report.stamp.dataSources?.join(', ') ?? 'PFS'}]</div>
          </div>
          <div style={{ textAlign: 'center', padding: '36px 24px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}><div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 12 }}>Have a medical bill of your own?</div><Link href="/audit" className="btn btn-primary">Audit Your Bill for Free</Link></div>
        </div>
      </main>
      <footer style={{ borderTop: '1px solid var(--border)', padding: 'var(--space-6) 0', background: 'var(--surface)' }}><div className="container" style={{ textAlign: 'center', fontSize: '0.8125rem', color: 'var(--text-faint)' }}>BillScan — Based on CMS.gov data · Not legal or medical advice ·{' '}<Link href="/">billscan.app</Link></div></footer>
    </>
  );
}
