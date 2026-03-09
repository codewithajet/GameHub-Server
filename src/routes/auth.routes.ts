// src/routes/auth.routes.ts
import express from 'express';
import {
  register,
  login,
  getMe,
  logout,
  googleAuth,
  deviceLogin,
} from '../controllers/auth.controller';
import { protect } from '../middleware/auth.middleware';

const router = express.Router();

// ── Public (no JWT required) ──────────────────────────────────────────────────
router.post('/register',     register);
router.post('/login',        login);
router.post('/google',       googleAuth);   // Google OAuth sign-in / sign-up
router.post('/device-login', deviceLogin); // Silent auto-login via device ID

// ── Protected (JWT required) ──────────────────────────────────────────────────
router.get('/me',      protect, getMe);
router.post('/logout', protect, logout);

export default router;