import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized({ token, req }) {
        const { pathname } = req.nextUrl;

        // Public routes — always allow
        const publicPaths = [
          '/',
          '/login',
          '/pricing',
          '/api/health',
        ];
        if (publicPaths.some((p) => pathname === p)) return true;

        // NextAuth internal routes — always allow
        if (pathname.startsWith('/api/auth')) return true;

        // Protected routes — require token
        if (
          pathname.startsWith('/audit') ||
          pathname.startsWith('/report') ||
          pathname.startsWith('/api/audit') ||
          pathname.startsWith('/api/stats') ||
          pathname.startsWith('/api/charity-check') ||
          pathname.startsWith('/api/stripe')
        ) {
          return !!token;
        }

        // Default allow
        return true;
      },
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
