import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authOptions } from '../../lib/auth';
import { checkUsage, incrementUsage } from '../../lib/usage';
import { checkRateLimit, getClientIp } from '../../lib/rate-limit';
import { runAudit } from '../../../../src/analyzer/audit';
import { generateDisputeLetter } from '../../../../src/dispute/letter-generator';
import { generatePhoneScript } from '../../../../src/dispute/phone-script';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const clientIp = getClientIp(req);
  const rateLimitKey = session?.user?.email ?? clientIp;
  const rateCheck = checkRateLimit(rateLimitKey, !!session);

  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a minute and try again.' },
      { status: 429, headers: { 'X-RateLimit-Limit': String(rateCheck.limit), 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(rateCheck.resetAt / 1000)), 'Retry-After': '60' } }
    );
  }

  if (!session?.user?.email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const email = session.user.email;

  const usage = await checkUsage(email);
  if (!usage.allowed) return NextResponse.json({ error: `Monthly limit reached. You've used all ${usage.limit} free audits this month.`, code: 'USAGE_LIMIT', usedCount: usage.count, limit: usage.limit }, { status: 402 });

  let formData: FormData;
  try { formData = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }

  const file = formData.get('file');
  if (!file || !(file instanceof Blob)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  const fileName = (file as File).name ?? 'upload';
  const ext = fileName.split('.').pop()?.toLowerCase();
  const allowedExts = ['json', 'pdf', 'jpg', 'jpeg', 'png'];
  if (!ext || !allowedExts.includes(ext)) return NextResponse.json({ error: `Unsupported file type. Accepted: ${allowedExts.join(', ')}` }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 20MB)' }, { status: 400 });

  const tmpPath = join('/tmp', `billscan-${randomUUID()}.${ext}`);
  try {
    const bytes = await file.arrayBuffer();
    await writeFile(tmpPath, Buffer.from(bytes));
  } catch (err) {
    console.error('[audit] write error:', err);
    return NextResponse.json({ error: 'Failed to process uploaded file' }, { status: 500 });
  }

  let report;
  try {
    const zip = formData.get('zip')?.toString();
    const locality = formData.get('locality')?.toString();
    const setting = formData.get('setting')?.toString() as 'facility' | 'office' | undefined;
    report = await runAudit(tmpPath, { zip, locality, setting, save: true });
  } catch (err) {
    console.error('[audit] run error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Audit failed' }, { status: 500 });
  } finally {
    await unlink(tmpPath).catch(() => {});
  }

  await incrementUsage(email).catch(console.error);

  const isPro = usage.isPro;
  let disputeLetter: string | undefined;
  let phoneScript: string | undefined;
  if (isPro) {
    try { disputeLetter = generateDisputeLetter(report); } catch (err) { console.error('[audit] dispute letter error:', err); }
    try { phoneScript = generatePhoneScript(report); } catch (err) { console.error('[audit] phone script error:', err); }
  }

  return NextResponse.json({ report, isPro, ...(disputeLetter ? { disputeLetter } : {}), ...(phoneScript ? { phoneScript } : {}), shareUrl: `/report/${report.stamp.reportId}`, usageAfter: { count: usage.count + 1, limit: usage.limit, isPro } });
}
