import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
}

// Augment Express request with the authenticated user (undefined when anonymous).
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  if (!config.jwtSecret) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.jwtSecret, {
    expiresIn: config.tokenTtlSeconds,
  });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(config.tokenCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.tokenTtlSeconds * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(config.tokenCookie);
}

/** The authenticated user, guaranteed by requireAuth before the route handler runs. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required.');
  return req.user;
}

/** Verifies the JWT cookie and loads the active user for every request it guards. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[config.tokenCookie] as string | undefined;
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required.');
    let payload: { sub: string };
    try {
      payload = jwt.verify(token, config.jwtSecret as string) as { sub: string };
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'Session invalid or expired. Sign in again.');
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Account not found or deactivated.');
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** Server-side role gate. The frontend may hide controls, but this is what enforces them. */
export function requireRole(role: 'ADMIN'): (req: Request, res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    if (req.user?.role !== role) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
      return;
    }
    next();
  };
}
