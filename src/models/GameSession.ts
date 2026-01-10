// ============================================
// FILE: src/models/GameSession.ts
// ============================================
import mongoose, { Schema, Document } from 'mongoose';

export type GameType = 'tic-tac-toe' | 'chess' | 'checkers';
export type GameStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';

export interface IGameSession extends Document {
  gameType: GameType;
  status: GameStatus;
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
      enum: ['waiting', 'playing', 'finished', 'abandoned'],
      default: 'waiting',
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

// Index for faster queries
GameSessionSchema.index({ status: 1, gameType: 1 });
GameSessionSchema.index({ 'players.player1': 1, 'players.player2': 1 });

export default mongoose.model<IGameSession>('GameSession', GameSessionSchema);
