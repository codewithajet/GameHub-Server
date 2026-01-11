// ============================================
// DEBUGGED & FIXED: src/socket/socketHandler.ts
// Fixed matching logic to properly connect players
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
  console.log(`📢 Broadcasting queue update for ${gameType}: ${queue.length} players`);
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
    io.to(roomId).emit('opponent-left', {
      message: 'Opponent left to search for a new game',
    });
    activeGames.delete(userId);
  }
}

// Helper function to remove player from all queues
function removeFromAllQueues(userId: string, io: Server) {
  waitingQueue.forEach((queue, gameType) => {
    const index = queue.findIndex((p) => p.userId === userId);
    if (index !== -1) {
      queue.splice(index, 1);
      console.log(`🗑️ Removed user ${userId} from ${gameType} queue`);
      broadcastQueueUpdate(io, gameType);
    }
  });
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
    // MATCHMAKING - FIXED LOGIC
    // ===================================
    socket.on('find-match', async ({ gameType }) => {
      console.log(`\n🔍 ${username} (${userId}) searching for ${gameType} match...`);

      // Clean up any existing active game first
      cleanupPlayerGame(userId, io);
      
      // Remove from all other queues first
      removeFromAllQueues(userId, io);

      // Initialize queue for this game type
      if (!waitingQueue.has(gameType)) {
        waitingQueue.set(gameType, []);
      }

      const queue = waitingQueue.get(gameType)!;
      
      console.log(`📊 Current queue for ${gameType}:`, queue.map(p => `${p.username} (${p.userId})`));

      // Check if someone ELSE is waiting (not the same user)
      const waitingOpponent = queue.find(p => p.userId !== userId);

      if (waitingOpponent) {
        // MATCH FOUND! Remove opponent from queue
        const opponentIndex = queue.findIndex(p => p.userId === waitingOpponent.userId);
        queue.splice(opponentIndex, 1);
        
        console.log(`\n🎮 MATCH FOUND!`);
        console.log(`   Player 1: ${username} (${userId})`);
        console.log(`   Player 2: ${waitingOpponent.username} (${waitingOpponent.userId})`);

        // Create game room
        const roomId = `${gameType}-${Date.now()}`;
        
        // Join both players to the room
        socket.join(roomId);
        const opponentSocket = io.sockets.sockets.get(waitingOpponent.socketId);
        
        if (!opponentSocket) {
          console.error(`❌ ERROR: Opponent socket not found for ${waitingOpponent.username}`);
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
        console.log(`   Room ID: ${roomId}`);

        // Set active games for both players
        activeGames.set(userId, roomId);
        activeGames.set(waitingOpponent.userId, roomId);
        
        console.log(`   Active games map updated`);

        try {
          // Create game session in database
          const gameSession = await GameSession.create({
            gameType,
            status: 'playing',
            players: {
              player1: new mongoose.Types.ObjectId(userId),
              player2: new mongoose.Types.ObjectId(waitingOpponent.userId),
            },
            currentTurn: new mongoose.Types.ObjectId(userId),
            startedAt: new Date(),
          });

          console.log(`   Session created: ${gameSession._id}`);

          // Notify both players
          const matchData = {
            roomId,
            gameType,
            sessionId: gameSession._id,
            players: [
              { userId, username, role: 'player1' },
              { userId: waitingOpponent.userId, username: waitingOpponent.username, role: 'player2' },
            ],
            currentTurn: userId,
          };

          console.log(`   Sending match-found to room ${roomId}`);
          io.to(roomId).emit('match-found', matchData);

          console.log(`✅ Match successfully created!\n`);
          
          // Broadcast queue update
          broadcastQueueUpdate(io, gameType);
        } catch (error) {
          console.error(`❌ ERROR creating game session:`, error);
          // Clean up on error
          activeGames.delete(userId);
          activeGames.delete(waitingOpponent.userId);
          socket.leave(roomId);
          opponentSocket.leave(roomId);
          
          // Put both players back in queue
          queue.push({ 
            userId, 
            socketId: socket.id, 
            username, 
            gameType,
            joinedAt: Date.now() 
          });
          queue.push(waitingOpponent);
          
          socket.emit('error', { message: 'Failed to create game session. Please try again.' });
          opponentSocket.emit('error', { message: 'Failed to create game session. Please try again.' });
        }
      } else {
        // No one waiting, add to queue
        queue.push({ 
          userId, 
          socketId: socket.id, 
          username, 
          gameType,
          joinedAt: Date.now() 
        });
        
        console.log(`⏳ No opponent found. Added ${username} to queue.`);
        console.log(`   Queue size: ${queue.length}`);
        console.log(`   Queue contents:`, queue.map(p => `${p.username} (${p.userId})`));
        
        socket.emit('searching', { 
          message: 'Searching for opponent...',
          queuePosition: queue.length,
          playersWaiting: queue.length
        });
        
        // Broadcast queue update to all clients
        broadcastQueueUpdate(io, gameType);
        
        console.log(`📢 Notified all clients of queue update\n`);
      }
    });

    // Cancel matchmaking
    socket.on('cancel-search', ({ gameType }) => {
      console.log(`❌ ${username} cancelling search for ${gameType}`);
      const queue = waitingQueue.get(gameType);
      if (queue) {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          socket.emit('search-cancelled', { message: 'Search cancelled' });
          broadcastQueueUpdate(io, gameType);
          console.log(`   ${username} removed from queue (${queue.length} remaining)`);
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
      removeFromAllQueues(userId, io);
    });

    // ===================================
    // DISCONNECT
    // ===================================
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${username}`);

      connectedUsers.delete(userId);

      // Remove from all waiting queues
      removeFromAllQueues(userId, io);

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