
// ============================================
// FIX 2: src/controllers/game.controller.ts (COMPLETE REPLACEMENT)
// ============================================
import { Response } from 'express';
import { AuthRequest } from '../types';
import GameSession from '../models/GameSession';
import User from '../models/User';

export const getGameHistory = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId;
    const gameType = req.query.gameType as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;

    const query: any = {
      $or: [
        { 'players.player1': userId },
        { 'players.player2': userId },
      ],
      status: 'finished',
    };

    if (gameType) {
      query.gameType = gameType;
    }

    const games = await GameSession.find(query)
      .sort({ finishedAt: -1 })
      .limit(limit)
      .populate('players.player1', 'name email')
      .populate('players.player2', 'name email')
      .populate('winner', 'name');

    res.status(200).json({
      success: true,
      data: { games },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching game history',
      error: error.message,
    });
  }
};

export const getLeaderboard = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const gameType = req.query.gameType as string | undefined;
    let sortField = 'stats.gamesWon';

    if (gameType) {
      sortField = `gameStats.${gameType}.wins`;
    }

    const sortOptions: any = {};
    sortOptions[sortField] = -1;

    const users = await User.find()
      .select('name stats gameStats')
      .sort(sortOptions)
      .limit(100);

    res.status(200).json({
      success: true,
      data: { leaderboard: users },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error fetching leaderboard',
      error: error.message,
    });
  }
};
