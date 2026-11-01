// One-off helper: prints a valid session token for the given email so the
// browser session can be restored for screenshot capture. Not part of the app.
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();
const email = process.argv[2] ?? 'admin@vetpulse.dev';
const user = await prisma.user.findUnique({ where: { email } });
if (!user) throw new Error('user not found: ' + email);
const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
  expiresIn: 60 * 60 * 8,
});
console.log(token);
await prisma.$disconnect();
