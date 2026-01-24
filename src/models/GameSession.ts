// ============================================
// FILE: src/models/GameSession.ts - FIXED with roomId
// ============================================
import mongoose, { Schema, Document } from 'mongoose';

export type GameType = 'tic-tac-toe' | 'chess' | 'checkers';
export type GameStatus = 'waiting' | 'active' | 'finished' | 'abandoned';

export interface IGameSession extends Document {
  gameType: GameType;
  status: GameStatus;
  roomId?: string; // ADDED: Room ID for socket.io room management
  players: {
    player1: mongoose.Types.ObjectId;
    player2?: mongoose.Types.ObjectId;
  };
  currentTurn?: mongoose.Types.ObjectId;
  gameState: any; // Flexible game state object
  winner?: mongoose.Types.ObjectId;
  isDraw: boolean;
  moves: Array<{
    playerId: mongoose.Types.ObjectId;
    move: any;
    timestamp: Date;
  }>;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GameSessionSchema = new Schema<IGameSession>(
  {
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
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
GameSessionSchema.index({ status: 1, gameType: 1 });
GameSessionSchema.index({ 'players.player1': 1, 'players.player2': 1 });
GameSessionSchema.index({ roomId: 1 });
GameSessionSchema.index({ status: 1, 'players.player1': 1 });
GameSessionSchema.index({ status: 1, 'players.player2': 1 });

export default mongoose.model<IGameSession>('GameSession', GameSessionSchema);