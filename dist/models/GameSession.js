// ============================================
// FILE: src/models/GameSession.ts - FIXED with roomId
// ============================================
import mongoose, { Schema } from 'mongoose';
const GameSessionSchema = new Schema({
    gameType: {
        type: String,
        enum: ['tic-tac-toe', 'chess', 'checkers'],
        required: true,
    },
    status: {
        type: String,
        enum: ['waiting', 'active', 'finished', 'abandoned'],
        default: 'waiting',
    },
    roomId: {
        type: String,
        // Room ID for socket.io - generated when match is found
    },
    players: {
        player1: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        player2: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    currentTurn: {
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
    gameState: {
        type: Schema.Types.Mixed,
        default: {},
    },
    winner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
    isDraw: {
        type: Boolean,
        default: false,
    },
    moves: [
        {
            playerId: {
                type: Schema.Types.ObjectId,
                ref: 'User',
                required: true,
            },
            move: Schema.Types.Mixed,
            timestamp: {
                type: Date,
                default: Date.now,
            },
        },
    ],
    startedAt: Date,
    finishedAt: Date,
}, {
    timestamps: true,
});
// Indexes for faster queries
GameSessionSchema.index({ status: 1, gameType: 1 });
GameSessionSchema.index({ 'players.player1': 1, 'players.player2': 1 });
GameSessionSchema.index({ roomId: 1 });
GameSessionSchema.index({ status: 1, 'players.player1': 1 });
GameSessionSchema.index({ status: 1, 'players.player2': 1 });
export default mongoose.model('GameSession', GameSessionSchema);
//# sourceMappingURL=GameSession.js.map