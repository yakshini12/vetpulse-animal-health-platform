import { z } from 'zod';
import { Response, Request, NextFunction, Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { AppError } from '../errors.js';
import { parseWith } from '../middleware/validate.js';
import {
  clearAuthCookie,
  requireAuth,
  setAuthCookie,
  signToken,
  type AuthUser,
} from './middleware.js';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

function publicUser(user: { id: string; email: string; name: string; role: 'ADMIN' | 'STAFF'; isActive: boolean }): AuthUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function authRouter(): Router {
  const router = Router();

  router.post('/auth/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseWith(loginSchema, req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      // Same generic message for unknown email and wrong password (no account enumeration).
      if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      }
      if (!user.isActive) {
        throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account has been deactivated. Contact an administrator.');
      }
      const sessionUser = publicUser(user);
      setAuthCookie(res, signToken(sessionUser));
      res.json({ user: sessionUser });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
