// ============================================
// FIXED: src/socket/socketHandler.ts
// Properly clears activeGames before matchmaking
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
  joinedAt: number;
}

const connectedUsers = new Map<string, SocketUser>();
const waitingQueue = new Map<string, WaitingPlayer[]>();
const activeGames = new Map<string, string>();

// Broadcast queue updates to all connected clients
function broadcastQueueUpdate(io: Server, gameType: string) {
  const queue = waitingQueue.get(gameType) || [];
  io.emit('queue-update', {
    gameType,
    playersWaiting: queue.length,
    players: queue.map(p => ({ username: p.username, waitTime: Date.now() - p.joinedAt }))
  });
}

// Helper function to clean up player from active games
function cleanupPlayerGame(userId: string, io: Server) {
  const roomId = activeGames.get(userId);
  if (roomId) {
    console.log(`🧹 Cleaning up active game for user ${userId}`);
    
    // Notify opponent if still in room
    io.to(roomId).emit('opponent-left', {
      message: 'Opponent left to search for a new game',
    });
    
    // Remove from active games
    activeGames.delete(userId);
  }
}

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

    connectedUsers.set(userId, {
      userId,
      socketId: socket.id,
      username,
    });

    User.findByIdAndUpdate(userId, {
      isOnline: true,
      lastActive: new Date(),
    }).exec();

    socket.emit('connected', {
      userId,
      username,
      message: 'Connected to GameHub',
    });

    // Send current queue sizes on connection
    ['tic-tac-toe', 'chess', 'checkers'].forEach(gameType => {
      const queue = waitingQueue.get(gameType) || [];
      socket.emit('queue-update', {
        gameType,
        playersWaiting: queue.length
      });
    });

    // ===================================
    // MATCHMAKING
    // ===================================
    socket.on('find-match', async ({ gameType }) => {
      console.log(`🔍 ${username} searching for ${gameType} match...`);

      // IMPORTANT: Clean up any existing active game first
      cleanupPlayerGame(userId, io);

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
        // Find first player that isn't the current user
        const opponentIndex = queue.findIndex(p => p.userId !== userId);
        
        if (opponentIndex === -1) {
          // Only self in queue, add to queue
          queue.push({ 
            userId, 
            socketId: socket.id, 
            username, 
            gameType,
            joinedAt: Date.now() 
          });
          socket.emit('searching', { 
            message: 'Searching for opponent...',
            queuePosition: queue.length,
            playersWaiting: queue.length
          });
          broadcastQueueUpdate(io, gameType);
          console.log(`⏳ ${username} added to ${gameType} queue (${queue.length} waiting)`);
          return;
        }

        const opponent = queue.splice(opponentIndex, 1)[0];
        
        console.log(`🎮 Matching ${username} with ${opponent.username}`);

        // Create game room
        const roomId = `${gameType}-${Date.now()}`;
        
        socket.join(roomId);
        const opponentSocket = io.sockets.sockets.get(opponent.socketId);
        
        if (!opponentSocket) {
          console.error(`❌ Opponent socket not found for ${opponent.username}`);
          // Put current player in queue instead
          queue.push({ 
            userId, 
            socketId: socket.id, 
            username, 
            gameType,
            joinedAt: Date.now() 
          });
          socket.emit('searching', { 
            message: 'Searching for opponent...',
            queuePosition: queue.length,
            playersWaiting: queue.length
          });
          broadcastQueueUpdate(io, gameType);
          return;
        }

        opponentSocket.join(roomId);

        // IMPORTANT: Set active games BEFORE creating session
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
          currentTurn: new mongoose.Types.ObjectId(userId),
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

        console.log(`✅ Match created: ${username} vs ${opponent.username} in room ${roomId}`);
        
        // Broadcast queue update
        broadcastQueueUpdate(io, gameType);
      } else {
        // Add to waiting queue
        queue.push({ 
          userId, 
          socketId: socket.id, 
          username, 
          gameType,
          joinedAt: Date.now() 
        });
        socket.emit('searching', { 
          message: 'Searching for opponent...',
          queuePosition: queue.length,
          playersWaiting: queue.length
        });
        
        // Broadcast queue update to all clients
        broadcastQueueUpdate(io, gameType);
        
        console.log(`⏳ ${username} added to ${gameType} queue (${queue.length} waiting)`);
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
          broadcastQueueUpdate(io, gameType);
          console.log(`❌ ${username} cancelled search (${queue.length} remaining)`);
        }
      }
    });

    // Get current queue status
    socket.on('get-queue-status', ({ gameType }) => {
      const queue = waitingQueue.get(gameType) || [];
      socket.emit('queue-update', {
        gameType,
        playersWaiting: queue.length
      });
    });

    // ===================================
    // GAME HANDLERS
    // ===================================
    handleTicTacToe(socket, io, activeGames);
    handleChess(socket, io, activeGames);
    handleCheckers(socket, io, activeGames);

    // ===================================
    // LEAVE GAME
    // ===================================
    socket.on('leave-game', async ({ sessionId }) => {
      console.log(`🚪 ${username} leaving game ${sessionId || 'unknown'}`);
      
      const roomId = activeGames.get(userId);
      
      if (roomId) {
        socket.to(roomId).emit('opponent-disconnected', {
          message: 'Opponent left the game',
        });
        
        activeGames.delete(userId);
        socket.leave(roomId);
        
        if (sessionId) {
          try {
            await GameSession.findByIdAndUpdate(sessionId, {
              status: 'abandoned',
              finishedAt: new Date(),
            });
          } catch (error) {
            console.error('Error updating session:', error);
          }
        }
        
        console.log(`✅ ${username} left game successfully`);
      }
      
      // Remove from all queues
      waitingQueue.forEach((queue, gameType) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          broadcastQueueUpdate(io, gameType);
          console.log(`🗑️ Removed ${username} from ${gameType} queue`);
        }
      });
    });

    // ===================================
    // DISCONNECT
    // ===================================
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${username}`);

      connectedUsers.delete(userId);

      // Remove from all waiting queues
      waitingQueue.forEach((queue, gameType) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          broadcastQueueUpdate(io, gameType);
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

      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastActive: new Date(),
      });
    });
  });
}