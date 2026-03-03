import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import { getDb } from '../../../src/db/connection';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }),
    GitHubProvider({ clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      try {
        const db = getDb();
        const existing = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [user.email] });
        if (existing.rows.length === 0) {
          await db.execute({ sql: 'INSERT INTO users (id, email, name, image, plan, audit_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [crypto.randomUUID(), user.email, user.name || '', user.image || '', 'free', 0, new Date().toISOString()] });
        }
        return true;
      } catch (err) { console.error('[auth] signIn error:', err); return false; }
    },
    async session({ session }) {
      if (!session.user?.email) return session;
      try {
        const db = getDb();
        const result = await db.execute({ sql: 'SELECT id, plan, audit_count, audit_reset_at FROM users WHERE email = ?', args: [session.user.email] });
        const row = result.rows[0] as { id: string; plan: string; audit_count: number; audit_reset_at: string | null } | undefined;
        if (row) {
          (session.user as Record<string, unknown>).id = row.id;
          (session.user as Record<string, unknown>).plan = row.plan;
          (session.user as Record<string, unknown>).auditCount = row.audit_count;
          (session.user as Record<string, unknown>).auditResetAt = row.audit_reset_at;
        }
      } catch (err) { console.error('[auth] session callback error:', err); }
      return session;
    },
    async jwt({ token, user }) { if (user) { token.email = user.email; } return token; },
  },
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
};
