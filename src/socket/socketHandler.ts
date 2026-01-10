// ============================================
// FILE: src/socket/socketHandler.ts
// ============================================
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import { verifyToken } from '../utils/jwt.utils';
import User from '../models/User';
import GameSession from '../models/GameSession';
import { handleTicTacToe } from './ticTacToe.handler';
import { handleChess } from './chess.handler';
import { handleCheckers } from './checkers.handler';

interface SocketUser {
  userId: string;
  socketId: string;
  username: string;
}

interface WaitingPlayer {
  userId: string;
  socketId: string;
  username: string;
  gameType: string;
}

// In-memory storage for active connections and waiting queues
const connectedUsers = new Map<string, SocketUser>();
const waitingQueue = new Map<string, WaitingPlayer[]>(); // gameType -> players[]
const activeGames = new Map<string, string>(); // userId -> roomId

export function initializeSocket(io: Server) {
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = verifyToken(token);
      const user = await User.findById(decoded.id);

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.data.userId = user._id.toString();
      socket.data.username = user.name;
      
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId;
    const username = socket.data.username;

    console.log(`✅ User connected: ${username} (${userId})`);

    // Store connected user
    connectedUsers.set(userId, {
      userId,
      socketId: socket.id,
      username,
    });

    // Update user online status
    User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastActive: new Date(),
    }).exec();

    // Send connection confirmation
    socket.emit('connected', {
      userId,
      username,
      message: 'Connected to GameHub',
    });

    // ===================================
    // MATCHMAKING
    // ===================================
    socket.on('find-match', async ({ gameType }) => {
      console.log(`🔍 ${username} searching for ${gameType} match...`);

      // Check if user already in a game
      if (activeGames.has(userId)) {
        socket.emit('error', { message: 'Already in an active game' });
        return;
      }

      // Initialize queue for this game type
      if (!waitingQueue.has(gameType)) {
        waitingQueue.set(gameType, []);
      }

      const queue = waitingQueue.get(gameType)!;

      // Check if player already in queue
      const alreadyInQueue = queue.find((p) => p.userId === userId);
      if (alreadyInQueue) {
        socket.emit('error', { message: 'Already searching for a match' });
        return;
      }

      // Check if someone is waiting
      if (queue.length > 0) {
        const opponent = queue.shift()!;
        
        // Don't match with yourself
        if (opponent.userId === userId) {
          queue.push({ userId, socketId: socket.id, username, gameType });
          return;
        }

        // Create game room
        const roomId = `${gameType}-${Date.now()}`;
        
        socket.join(roomId);
        io.sockets.sockets.get(opponent.socketId)?.join(roomId);

        // Store active game
        activeGames.set(userId, roomId);
        activeGames.set(opponent.userId, roomId);

        // Create game session in database
        const gameSession = await GameSession.create({
          gameType,
          status: 'playing',
          players: {
            player1: new mongoose.Types.ObjectId(userId),
            player2: new mongoose.Types.ObjectId(opponent.userId),
          },
          currentTurn: new mongoose.Types.ObjectId(userId), // Player 1 starts
          startedAt: new Date(),
        });

        // Notify both players
        io.to(roomId).emit('match-found', {
          roomId,
          gameType,
          sessionId: gameSession._id,
          players: [
            { userId, username, role: 'player1' },
            { userId: opponent.userId, username: opponent.username, role: 'player2' },
          ],
          currentTurn: userId,
        });

        console.log(`🎮 Match created: ${username} vs ${opponent.username}`);
      } else {
        // Add to waiting queue
        queue.push({ userId, socketId: socket.id, username, gameType });
        socket.emit('searching', { 
          message: 'Searching for opponent...',
          queuePosition: queue.length 
        });
      }
    });

    // Cancel matchmaking
    socket.on('cancel-search', ({ gameType }) => {
      const queue = waitingQueue.get(gameType);
      if (queue) {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          socket.emit('search-cancelled', { message: 'Search cancelled' });
        }
      }
    });

    // ===================================
    // GAME HANDLERS
    // ===================================
    handleTicTacToe(socket, io, activeGames);
    handleChess(socket, io, activeGames);
    handleCheckers(socket, io, activeGames);

    // ===================================
    // DISCONNECT
    // ===================================
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${username}`);

      // Remove from connected users
      connectedUsers.delete(userId);

      // Remove from all waiting queues
      waitingQueue.forEach((queue, gameType) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
        }
      });

      // Handle active game abandonment
      const roomId = activeGames.get(userId);
      if (roomId) {
        socket.to(roomId).emit('opponent-disconnected', {
          message: 'Opponent disconnected',
        });
        activeGames.delete(userId);
      }

      // Update user status
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastActive: new Date(),
      });
    });
  });
};
