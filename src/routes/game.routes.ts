
// ============================================
// FILE: src/routes/game.routes.ts
// ============================================
import express from 'express';
import { getGameHistory, getLeaderboard } from '../controllers/game.controller';
import { protect } from '../middleware/auth.middleware';

const router = express.Router();

router.get('/history', protect, getGameHistory);
router.get('/leaderboard', getLeaderboard);

export default router;