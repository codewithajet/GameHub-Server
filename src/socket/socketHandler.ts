// ============================================
// FULLY FIXED: src/socket/socketHandler.ts
// Players will now connect immediately when both searching
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

    // Send current queue sizes on connection
    ['tic-tac-toe', 'chess', 'checkers'].forEach(gameType => {
      const queue = waitingQueue.get(gameType) || [];
      socket.emit('queue-update', {
        gameType,
        playersWaiting: queue.length
      });
    });

    // ===================================
    // MATCHMAKING - COMPLETELY FIXED
    // ===================================
    socket.on('find-match', async ({ gameType }) => {
      console.log(`\n🔍 ${username} (${userId}) is searching for ${gameType}...`);
      console.log(`   Socket ID: ${socket.id}`);

      // STEP 1: Clean up any previous game/queue for this user
      const oldRoomId = activeGames.get(userId);
      if (oldRoomId) {
        console.log(`   🧹 Cleaning up old game room: ${oldRoomId}`);
        socket.to(oldRoomId).emit('opponent-left', {
          message: 'Opponent left to search for a new game',
        });
        activeGames.delete(userId);
        socket.leave(oldRoomId);
      }

      // Remove from ALL queues
      waitingQueue.forEach((queue, gt) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          console.log(`   🗑️ Removed from ${gt} queue`);
        }
      });

      // STEP 2: Initialize queue for this game type
      if (!waitingQueue.has(gameType)) {
        waitingQueue.set(gameType, []);
      }

      const queue = waitingQueue.get(gameType)!;
      console.log(`   📊 Current queue size: ${queue.length}`);
      console.log(`   📊 Queue players:`, queue.map(p => `${p.username} (${p.userId.substring(0, 8)}...)`));

      // STEP 3: Look for an opponent (anyone who is NOT this user)
      let opponentIndex = -1;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].userId !== userId) {
          opponentIndex = i;
          break;
        }
      }

      if (opponentIndex !== -1) {
        // MATCH FOUND!
        const opponent = queue[opponentIndex];
        
        console.log(`\n🎮 MATCH FOUND!`);
        console.log(`   Player 1: ${username} (${userId.substring(0, 8)}...)`);
        console.log(`   Player 2: ${opponent.username} (${opponent.userId.substring(0, 8)}...)`);

        // Remove opponent from queue
        queue.splice(opponentIndex, 1);
        console.log(`   ✅ Removed opponent from queue. New size: ${queue.length}`);

        // Create unique room ID
        const roomId = `${gameType}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        console.log(`   🏠 Created room: ${roomId}`);

        // Get opponent socket
        const opponentSocket = io.sockets.sockets.get(opponent.socketId);
        
        if (!opponentSocket) {
          console.error(`   ❌ ERROR: Cannot find opponent socket!`);
          console.error(`      Opponent socket ID: ${opponent.socketId}`);
          console.error(`      Available sockets:`, Array.from(io.sockets.sockets.keys()));
          
          // Put current player in queue
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

        // Join both sockets to the room
        socket.join(roomId);
        opponentSocket.join(roomId);
        console.log(`   ✅ Both players joined room ${roomId}`);

        // Mark both as in active game
        activeGames.set(userId, roomId);
        activeGames.set(opponent.userId, roomId);
        console.log(`   ✅ Both players marked as in active game`);

        try {
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

          console.log(`   ✅ Game session created: ${gameSession._id}`);

          // Prepare match data
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

          console.log(`   📤 Sending match-found to both players...`);
          
          // Send to BOTH players individually to ensure delivery
          socket.emit('match-found', matchData);
          opponentSocket.emit('match-found', matchData);
          
          console.log(`   ✅ MATCH CREATED SUCCESSFULLY!\n`);
          
          // Update queue for everyone
          broadcastQueueUpdate(io, gameType);
          
        } catch (error) {
          console.error(`   ❌ ERROR creating game session:`, error);
          
          // Clean up on error
          activeGames.delete(userId);
          activeGames.delete(opponent.userId);
          socket.leave(roomId);
          opponentSocket.leave(roomId);
          
          // Put both back in queue
          queue.push({ 
            userId, 
            socketId: socket.id, 
            username, 
            gameType,
            joinedAt: Date.now() 
          });
          queue.push(opponent);
          
          socket.emit('error', { message: 'Failed to create game. Please try again.' });
          opponentSocket.emit('error', { message: 'Failed to create game. Please try again.' });
          
          broadcastQueueUpdate(io, gameType);
        }
      } else {
        // No opponent found, add to queue
        const newPlayer = { 
          userId, 
          socketId: socket.id, 
          username, 
          gameType,
          joinedAt: Date.now() 
        };
        
        queue.push(newPlayer);
        
        console.log(`   ⏳ No opponent available. Added to queue.`);
        console.log(`   📊 New queue size: ${queue.length}`);
        console.log(`   📊 Queue now contains:`, queue.map(p => `${p.username} (${p.userId.substring(0, 8)}...)`));
        
        socket.emit('searching', { 
          message: 'Searching for opponent...',
          queuePosition: queue.length,
          playersWaiting: queue.length
        });
        
        broadcastQueueUpdate(io, gameType);
        console.log(`   ✅ Search status sent to player\n`);
      }
    });

    // Cancel matchmaking
    socket.on('cancel-search', ({ gameType }) => {
      console.log(`\n❌ ${username} cancelling search for ${gameType}`);
      const queue = waitingQueue.get(gameType);
      if (queue) {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          console.log(`   ✅ Removed from queue. New size: ${queue.length}`);
          socket.emit('search-cancelled', { message: 'Search cancelled' });
          broadcastQueueUpdate(io, gameType);
        } else {
          console.log(`   ⚠️ Player not found in queue`);
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
      console.log(`\n🚪 ${username} leaving game ${sessionId || 'unknown'}`);
      
      const roomId = activeGames.get(userId);
      
      if (roomId) {
        console.log(`   📤 Notifying opponent in room ${roomId}`);
        socket.to(roomId).emit('opponent-disconnected', {
          message: 'Opponent left the game',
        });
        
        activeGames.delete(userId);
        socket.leave(roomId);
        console.log(`   ✅ Left room and removed from active games`);
        
        if (sessionId) {
          try {
            await GameSession.findByIdAndUpdate(sessionId, {
              status: 'abandoned',
              finishedAt: new Date(),
            });
            console.log(`   ✅ Session marked as abandoned`);
          } catch (error) {
            console.error('   ❌ Error updating session:', error);
          }
        }
      }
      
      // Remove from all queues
      waitingQueue.forEach((queue, gameType) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          console.log(`   🗑️ Removed from ${gameType} queue`);
          broadcastQueueUpdate(io, gameType);
        }
      });
    });

    // ===================================
    // DISCONNECT
    // ===================================
    socket.on('disconnect', async (reason) => {
      console.log(`\n❌ ${username} disconnected. Reason: ${reason}`);

      connectedUsers.delete(userId);

      // Remove from all waiting queues
      waitingQueue.forEach((queue, gameType) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          console.log(`   🗑️ Removed from ${gameType} queue`);
          broadcastQueueUpdate(io, gameType);
        }
      });

      // Handle active game abandonment
      const roomId = activeGames.get(userId);
      if (roomId) {
        console.log(`   📤 Notifying opponent about disconnect`);
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

  // Log server info
  console.log('\n🚀 Socket.IO server initialized and ready for connections\n');
}