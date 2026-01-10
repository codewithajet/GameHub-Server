"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLeaderboard = exports.getGameHistory = void 0;
const GameSession_1 = __importDefault(require("../models/GameSession"));
const User_1 = __importDefault(require("../models/User"));
const getGameHistory = async (req, res) => {
    try {
        const userId = req.userId;
        const gameType = req.query.gameType;
        const limit = parseInt(req.query.limit) || 10;
        const query = {
            $or: [
                { 'players.player1': userId },
                { 'players.player2': userId },
            ],
            status: 'finished',
        };
        if (gameType) {
            query.gameType = gameType;
        }
        const games = await GameSession_1.default.find(query)
            .sort({ finishedAt: -1 })
            .limit(limit)
            .populate('players.player1', 'name email')
            .populate('players.player2', 'name email')
            .populate('winner', 'name');
        res.status(200).json({
            success: true,
            data: { games },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching game history',
            error: error.message,
        });
    }
};
exports.getGameHistory = getGameHistory;
const getLeaderboard = async (req, res) => {
    try {
        const gameType = req.query.gameType;
        let sortField = 'stats.gamesWon';
        if (gameType) {
            sortField = `gameStats.${gameType}.wins`;
        }
        const sortOptions = {};
        sortOptions[sortField] = -1;
        const users = await User_1.default.find()
            .select('name stats gameStats')
            .sort(sortOptions)
            .limit(100);
        res.status(200).json({
            success: true,
            data: { leaderboard: users },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching leaderboard',
            error: error.message,
        });
    }
};
exports.getLeaderboard = getLeaderboard;
//# sourceMappingURL=game.controller.js.map