// ============================================
// FILE: src/socket/socketHandler.ts - COMPLETE WORKING VERSION
// ============================================
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import { verifyToken } from '../utils/jwt.utils';
import User from '../models/User';
import GameSession from '../models/GameSession';

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
    // TIC-TAC-TOE HANDLER
    // ===================================
    socket.on('tic-tac-toe:move', async (data) => {
      const { roomId, position, sessionId } = data;
      
      try {
        console.log(`🎯 Tic-Tac-Toe move: position ${position}`);

        const session = await GameSession.findById(sessionId);
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        if (session.currentTurn?.toString() !== userId) {
          socket.emit('error', { message: 'Not your turn' });
          return;
        }

        const isPlayer1 = session.players.player1.toString() === userId;
        const playerSymbol = isPlayer1 ? 'X' : 'O';

        let board: (string | null)[] = session.gameState?.board || Array(9).fill(null);

        if (board[position] !== null) {
          socket.emit('error', { message: 'Invalid move' });
          return;
        }

        board[position] = playerSymbol;

        session.moves.push({
          playerId: new mongoose.Types.ObjectId(userId),
          move: { position, symbol: playerSymbol },
          timestamp: new Date(),
        });

        const winner = checkTicTacToeWinner(board);
        session.gameState = { board };

        if (winner) {
          session.status = 'finished';
          session.finishedAt = new Date();
          
          if (winner === 'TIE') {
            session.isDraw = true;
            await User.findByIdAndUpdate(session.players.player1, {
              $inc: { 'stats.gamesPlayed': 1, 'stats.gamesTied': 1, 'gameStats.tic-tac-toe.ties': 1 }
            });
            await User.findByIdAndUpdate(session.players.player2, {
              $inc: { 'stats.gamesPlayed': 1, 'stats.gamesTied': 1, 'gameStats.tic-tac-toe.ties': 1 }
            });
          } else {
            const winnerId = winner === 'X' ? session.players.player1 : session.players.player2;
            const loserId = winner === 'X' ? session.players.player2 : session.players.player1;
            session.winner = winnerId;
            
            await User.findByIdAndUpdate(winnerId, {
              $inc: { 'stats.gamesPlayed': 1, 'stats.gamesWon': 1, 'gameStats.tic-tac-toe.wins': 1 }
            });
            await User.findByIdAndUpdate(loserId, {
              $inc: { 'stats.gamesPlayed': 1, 'stats.gamesLost': 1, 'gameStats.tic-tac-toe.losses': 1 }
            });
          }
        } else {
          session.currentTurn = isPlayer1 ? session.players.player2 : session.players.player1;
        }

        await session.save();

        io.to(roomId).emit('tic-tac-toe:move-made', {
          board: session.gameState.board,
          position,
          currentTurn: session.currentTurn?.toString(),
          winner: winner || null,
          gameOver: session.status === 'finished',
        });

        if (session.status === 'finished') {
          activeGames.delete(session.players.player1.toString());
          if (session.players.player2) {
            activeGames.delete(session.players.player2.toString());
          }
        }
      } catch (error) {
        console.error('❌ Tic-Tac-Toe error:', error);
        socket.emit('error', { message: 'Error processing move' });
      }
    });

    socket.on('tic-tac-toe:reset', async (data) => {
      const { roomId, sessionId } = data;
      
      try {
        const session = await GameSession.findById(sessionId);
        if (!session) return;

        session.gameState = { board: Array(9).fill(null) };
        session.status = 'active';
        session.currentTurn = session.players.player1;
        session.winner = undefined;
        session.isDraw = false;
        session.moves = [];
        session.finishedAt = undefined;

        await session.save();

        io.to(roomId).emit('tic-tac-toe:reset', {
          board: session.gameState.board,
          currentTurn: session.currentTurn?.toString(),
        });
      } catch (error) {
        console.error('❌ Reset error:', error);
      }
    });

    // ===================================
    // CHESS HANDLER
    // ===================================
    socket.on('chess:move', async (data) => {
      const { roomId, from, to, sessionId, gameState, winner } = data;
      
      try {
        console.log(`♟️ Chess move: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);

        const session = await GameSession.findById(sessionId);
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        if (session.currentTurn?.toString() !== userId) {
          socket.emit('error', { message: 'Not your turn' });
          return;
        }

        const isPlayer1 = session.players.player1.toString() === userId;
        const playerColor = isPlayer1 ? 'white' : 'black';

        session.moves.push({
          playerId: new mongoose.Types.ObjectId(userId),
          move: { from, to, color: playerColor },
          timestamp: new Date(),
        });

        session.gameState = gameState;

        if (winner) {
          session.status = 'finished';
          session.finishedAt = new Date();
          
          if (winner === 'draw') {
            session.isDraw = true;
            await User.findByIdAndUpdate(session.players.player1, {
              $inc: { 'stats.gamesPlayed': 1, 'stats.gamesTied': 1, 'gameStats.chess.ties': 1 }
            });
            await User.findByIdAndUpdate(session.players.player2, {
              $inc: { 'stats.gamesPlayed': 1, 'stats.gamesTied': 1, 'gameStats.chess.ties': 1 }
            });
          } else {
            const winnerId = winner === 'white' ? session.players.player1 : session.players.player2;
            const loserId = winner === 'white' ? session.players.player2 : session.players.player1;
            session.winner = winnerId;
            
            await User.findByIdAndUpdate(winnerId, {
              $inc: { 'stats.gamesPlayed': 1, 'stats.gamesWon': 1, 'gameStats.chess.wins': 1 }
            });
            await User.findByIdAndUpdate(loserId, {
              $inc: { 'stats.gamesPlayed': 1, 'stats.gamesLost': 1, 'gameStats.chess.losses': 1 }
            });
          }
        } else {
          session.currentTurn = isPlayer1 ? session.players.player2 : session.players.player1;
        }

        await session.save();

        io.to(roomId).emit('chess:move-made', {
          from,
          to,
          gameState: session.gameState,
          currentTurn: session.currentTurn?.toString(),
          winner: winner || null,
          gameOver: session.status === 'finished',
        });

        if (session.status === 'finished') {
          activeGames.delete(session.players.player1.toString());
          if (session.players.player2) {
            activeGames.delete(session.players.player2.toString());
          }
        }
      } catch (error) {
        console.error('❌ Chess error:', error);
        socket.emit('error', { message: 'Error processing move' });
      }
    });

    // ===================================
    // CHECKERS HANDLER
    // ===================================
    socket.on('checkers:move', async (data) => {
      const { roomId, from, to, sessionId, gameState, captured, mustContinue, winner } = data;
      
      try {
        console.log(`🎯 Checkers move: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);

        const session = await GameSession.findById(sessionId);
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        if (session.currentTurn?.toString() !== userId) {
          socket.emit('error', { message: 'Not your turn' });
          return;
        }

        const isPlayer1 = session.players.player1.toString() === userId;
        const playerColor = isPlayer1 ? 'red' : 'black';

        session.moves.push({
          playerId: new mongoose.Types.ObjectId(userId),
          move: { from, to, color: playerColor, captured },
          timestamp: new Date(),
        });

        session.gameState = gameState;

        if (winner) {
          session.status = 'finished';
          session.finishedAt = new Date();
          
          const winnerId = winner === 'red' ? session.players.player1 : session.players.player2;
          const loserId = winner === 'red' ? session.players.player2 : session.players.player1;
          session.winner = winnerId;
          
          await User.findByIdAndUpdate(winnerId, {
            $inc: { 'stats.gamesPlayed': 1, 'stats.gamesWon': 1, 'gameStats.checkers.wins': 1 }
          });
          await User.findByIdAndUpdate(loserId, {
            $inc: { 'stats.gamesPlayed': 1, 'stats.gamesLost': 1, 'gameStats.checkers.losses': 1 }
          });
        } else {
          if (!mustContinue) {
            session.currentTurn = isPlayer1 ? session.players.player2 : session.players.player1;
          }
        }

        await session.save();

        io.to(roomId).emit('checkers:move-made', {
          from,
          to,
          gameState: session.gameState,
          captured,
          mustContinue,
          currentTurn: session.currentTurn?.toString(),
          winner: winner || null,
          gameOver: session.status === 'finished',
        });

        if (session.status === 'finished') {
          activeGames.delete(session.players.player1.toString());
          if (session.players.player2) {
            activeGames.delete(session.players.player2.toString());
          }
        }
      } catch (error) {
        console.error('❌ Checkers error:', error);
        socket.emit('error', { message: 'Error processing move' });
      }
    });

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

      waitingQueue.forEach((queue, gameType) => {
        const index = queue.findIndex((p) => p.userId === userId);
        if (index !== -1) {
          queue.splice(index, 1);
          broadcastQueueUpdate(io, gameType);
        }
      });

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

// Helper function for tic-tac-toe winner check
function checkTicTacToeWinner(board: (string | null)[]): 'X' | 'O' | 'TIE' | null {
  const winningCombos = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  for (const combo of winningCombos) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as 'X' | 'O';
    }
  }

  if (board.every((cell) => cell !== null)) {
    return 'TIE';
  }

  return null;
}