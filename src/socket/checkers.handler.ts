// ============================================
// FIX: src/socket/checkers.handler.ts
// Add mongoose import at top
// ============================================
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import GameSession from '../models/GameSession';
import User from '../models/User';

export const handleCheckers = (
  socket: Socket,
  io: Server,
  activeGames: Map<string, string>
) => {
  socket.on('checkers:move', async (data) => {
    const { roomId, from, to, sessionId } = data;
    const userId = socket.data.userId;

    try {
      const session = await GameSession.findById(sessionId);
      
      if (!session) {
        socket.emit('error', { message: 'Game session not found' });
        return;
      }

      // Verify it's player's turn
      if (session.currentTurn?.toString() !== userId) {
        socket.emit('error', { message: 'Not your turn' });
        return;
      }

      // Determine player color
      const isPlayer1 = session.players.player1.toString() === userId;
      const playerColor = isPlayer1 ? 'red' : 'black';

      // Add move to history
      session.moves.push({
        playerId: new mongoose.Types.ObjectId(userId),
        move: { from, to, color: playerColor, captured: data.captured },
        timestamp: new Date(),
      });

      // Update game state
      session.gameState = data.gameState;

      // Check for game end
      if (data.winner) {
        session.status = 'finished';
        session.finishedAt = new Date();
        
        const winnerId = data.winner === 'red' ? session.players.player1 : session.players.player2;
        const loserId = data.winner === 'red' ? session.players.player2 : session.players.player1;
        
        session.winner = winnerId;
        
        await User.findByIdAndUpdate(winnerId, {
          $inc: { 
            'stats.gamesPlayed': 1,
            'stats.gamesWon': 1,
            'gameStats.checkers.wins': 1
          }
        });
        
        await User.findByIdAndUpdate(loserId, {
          $inc: { 
            'stats.gamesPlayed': 1,
            'stats.gamesLost': 1,
            'gameStats.checkers.losses': 1
          }
        });
      } else {
        // Switch turn (unless must continue capture)
        if (!data.mustContinue) {
          session.currentTurn = isPlayer1 ? session.players.player2 : session.players.player1;
        }
      }

      await session.save();

      // Broadcast move to room
      io.to(roomId).emit('checkers:move-made', {
        from,
        to,
        gameState: session.gameState,
        captured: data.captured,
        mustContinue: data.mustContinue,
        currentTurn: session.currentTurn?.toString(),
        winner: data.winner,
        gameOver: session.status === 'finished',
      });

      // Clean up active games if finished
      if (session.status === 'finished') {
        activeGames.delete(session.players.player1.toString());
        if (session.players.player2) {
          activeGames.delete(session.players.player2.toString());
        }
      }
    } catch (error) {
      console.error('Checkers move error:', error);
      socket.emit('error', { message: 'Error processing move' });
    }
  });

  // Handle king promotion
  socket.on('checkers:king-promotion', async (data) => {
    const { roomId, position } = data;
    
    io.to(roomId).emit('checkers:piece-kinged', {
      position,
    });
  });
};