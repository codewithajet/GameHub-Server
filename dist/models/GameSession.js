"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================
// FILE: src/models/GameSession.ts - FIXED with roomId
// ============================================
const mongoose_1 = __importStar(require("mongoose"));
const GameSessionSchema = new mongoose_1.Schema({
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
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        player2: {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    currentTurn: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
    gameState: {
        type: mongoose_1.Schema.Types.Mixed,
        default: {},
    },
    winner: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
    isDraw: {
        type: Boolean,
        default: false,
    },
    moves: [
        {
            playerId: {
                type: mongoose_1.Schema.Types.ObjectId,
                ref: 'User',
                required: true,
            },
            move: mongoose_1.Schema.Types.Mixed,
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
exports.default = mongoose_1.default.model('GameSession', GameSessionSchema);
//# sourceMappingURL=GameSession.js.map