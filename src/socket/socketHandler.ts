// ============================================
// FILE: src/socket/socketHandler.ts - FIXED (Uses Separate Handlers)
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

function broadcastQueueUpdate(io: Server, gameType: string) {
  const queue = waitingQueue.get(gameType) || [];
  console.log(`📢 Broadcasting queue update for ${gameType}: ${queue.length} players`);
  io.emit('queue-update', {
    gameType,
    playersWaiting: queue.length,
    players: queue.map(p => ({ username: p.username, waitTime: Date.now() - p.joinedAt }))
  });
}

export function initializeSocket(io: Server) {
  // Authentication middleware
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

    console.log(`\n✅ User connected: ${username} (${userId})`);
    console.log(`   Socket ID: ${socket.id}`);

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

    // Send current queue sizes
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
      console.log(`\n🔍 ${username} searching for ${gameType}...`);

      // Clean up old game/queue
      const oldRoomId = activeGames.get(userId);
      if (oldRoomId) {
        console.log(`   🧹 Cleaning up old room: ${oldRoomId}`);
        socket.to(oldRoomId).emit('opponent-left', {
          message: 'Opponent left to search for a new game',
        });
        activeGames.delete(userId);
        socket.leave(oldRoomId);
      }

      // Remove from all queues
      waitingQueue.forEach((queue, gt) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
        }
      });

      // Initialize queue
      if (!waitingQueue.has(gameType)) {
        waitingQueue.set(gameType, []);
      }

      const queue = waitingQueue.get(gameType)!;

      // Look for opponent
      let opponentIndex = -1;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].userId !== userId) {
          opponentIndex = i;
          break;
        }
      }

      if (opponentIndex !== -1) {
        // MATCH FOUND
        const opponent = queue[opponentIndex];
        queue.splice(opponentIndex, 1);

        console.log(`\n🎮 MATCH FOUND!`);
        console.log(`   Player 1: ${username}`);
        console.log(`   Player 2: ${opponent.username}`);

        const roomId = `${gameType}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        console.log(`   🏠 Room: ${roomId}`);

        const opponentSocket = io.sockets.sockets.get(opponent.socketId);
        
        if (!opponentSocket) {
          console.error(`   ❌ Opponent socket not found`);
          queue.push({ userId, socketId: socket.id, username, gameType, joinedAt: Date.now() });
          socket.emit('searching', { message: 'Searching...', playersWaiting: queue.length });
          broadcastQueueUpdate(io, gameType);
          return;
        }

        socket.join(roomId);
        opponentSocket.join(roomId);

        activeGames.set(userId, roomId);
        activeGames.set(opponent.userId, roomId);

        try {
          const gameSession = await GameSession.create({
            gameType,
            status: 'active',
            roomId: roomId,
            players: {
              player1: new mongoose.Types.ObjectId(userId),
              player2: new mongoose.Types.ObjectId(opponent.userId),
            },
            currentTurn: new mongoose.Types.ObjectId(userId),
            startedAt: new Date(),
          });

          console.log(`   ✅ Session: ${gameSession._id}`);
          console.log(`   ✅ Room ID saved: ${gameSession.roomId}`);

          const matchData = {
            roomId,
            gameType,
            sessionId: gameSession._id.toString(),
            players: [
              { userId, username, role: 'player1' },
              { userId: opponent.userId, username: opponent.username, role: 'player2' },
            ],
            currentTurn: userId,
          };

          socket.emit('match-found', matchData);
          opponentSocket.emit('match-found', matchData);
          
          broadcastQueueUpdate(io, gameType);
          
        } catch (error) {
          console.error(`   ❌ Error creating session:`, error);
          activeGames.delete(userId);
          activeGames.delete(opponent.userId);
          socket.leave(roomId);
          opponentSocket.leave(roomId);
          
          queue.push({ userId, socketId: socket.id, username, gameType, joinedAt: Date.now() });
          queue.push(opponent);
          
          socket.emit('error', { message: 'Failed to create game' });
          opponentSocket.emit('error', { message: 'Failed to create game' });
          broadcastQueueUpdate(io, gameType);
        }
      } else {
        // Add to queue
        queue.push({ userId, socketId: socket.id, username, gameType, joinedAt: Date.now() });
        console.log(`   ⏳ Added to queue (${queue.length} waiting)`);
        
        socket.emit('searching', { message: 'Searching...', playersWaiting: queue.length });
        broadcastQueueUpdate(io, gameType);
      }
    });

    // Cancel search
    socket.on('cancel-search', ({ gameType }) => {
      console.log(`\n❌ ${username} cancelled search`);
      const queue = waitingQueue.get(gameType);
      if (queue) {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          socket.emit('search-cancelled', { message: 'Search cancelled' });
          broadcastQueueUpdate(io, gameType);
        }
      }
    });

    // Get queue status
    socket.on('get-queue-status', ({ gameType }) => {
      const queue = waitingQueue.get(gameType) || [];
      socket.emit('queue-update', { gameType, playersWaiting: queue.length });
    });

    // ===================================
    // GAME HANDLERS (Separate Files)
    // ===================================
    handleTicTacToe(socket, io, activeGames);
    handleChess(socket, io, activeGames);
    handleCheckers(socket, io, activeGames);

    // ===================================
    // LEAVE GAME
    // ===================================
    socket.on('leave-game', async () => {
      console.log(`\n🚪 ${username} leaving game`);
      
      const roomId = activeGames.get(userId);
      
      if (roomId) {
        socket.to(roomId).emit('opponent-disconnected', {
          message: 'Opponent left the game',
        });
        
        activeGames.delete(userId);
        socket.leave(roomId);
      }
      
      waitingQueue.forEach((queue, gameType) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          broadcastQueueUpdate(io, gameType);
        }
      });
    });

    // ===================================
    // DISCONNECT
    // ===================================
    socket.on('disconnect', async (reason) => {
      console.log(`\n❌ ${username} disconnected: ${reason}`);

      connectedUsers.delete(userId);

      // Remove from queues
      waitingQueue.forEach((queue, gameType) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          broadcastQueueUpdate(io, gameType);
        }
      });

      // Handle active game
      const roomId = activeGames.get(userId);
      if (roomId) {
        socket.to(roomId).emit('opponent-disconnected', {
          message: 'Opponent disconnected',
        });
        activeGames.delete(userId);
        
        // Find and finish the game session
        try {
          const session = await GameSession.findOne({
            $or: [
              { 'players.player1': userId },
              { 'players.player2': userId }
            ],
            status: 'active'
          });

          if (session) {
            const isPlayer1 = session.players.player1.toString() === userId;
            const opponentId = isPlayer1 ? session.players.player2 : session.players.player1;

            session.status = 'finished';
            session.finishedAt = new Date();
            session.winner = opponentId;
            await session.save();

            if (opponentId) {
              activeGames.delete(opponentId.toString());
              
              // Award win to opponent
              const gameTypeStats = `gameStats.${session.gameType}.wins`;
              await User.findByIdAndUpdate(opponentId, {
                $inc: { 
                  'stats.gamesPlayed': 1,
                  'stats.gamesWon': 1,
                  [gameTypeStats]: 1
                }
              });

              // Record loss for disconnected player
              const lossStats = `gameStats.${session.gameType}.losses`;
              await User.findByIdAndUpdate(userId, {
                $inc: { 
                  'stats.gamesPlayed': 1,
                  'stats.gamesLost': 1,
                  [lossStats]: 1
                }
              });
            }
          }
        } catch (error) {
          console.error('Error handling disconnect:', error);
        }
      }

      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastActive: new Date(),
      });
    });
  });

  console.log('\n🚀 Socket.IO server initialized\n');
}