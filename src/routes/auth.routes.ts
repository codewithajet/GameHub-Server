// src/routes/auth.routes.ts
import express from 'express';
import {
  register,
  login,
  getMe,
  logout,
  updateProfile,  
} from '../controllers/auth.controller';
import { protect } from '../middleware/auth.middleware';

const router = express.Router();

router.post('/register', register);
router.post('/login',    login);
router.get('/me',        protect, getMe);
router.post('/logout',   protect, logout);
router.put('/profile',   protect, updateProfile);  

export default router;