// src/routes/auth.routes.ts
import express from 'express';
import {
  register,
  login,
  googleAuth,
  deviceLogin,
  getMe,
  logout,
  updateProfile,
} from '../controllers/auth.controller';
import { protect } from '../middleware/auth.middleware';

const router = express.Router();

// ── Public routes (no JWT needed) ─────────────────────────────────────────────
router.post('/register',     register);
router.post('/login',        login);
router.post('/google',       googleAuth);    // POST /api/auth/google
router.post('/device-login', deviceLogin);  // POST /api/auth/device-login

// ── Protected routes (JWT required) ───────────────────────────────────────────
router.get('/me',            protect, getMe);
router.post('/logout',       protect, logout);
router.put('/profile',       protect, updateProfile);

export default router;