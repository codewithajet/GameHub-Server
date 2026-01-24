// ============================================
// FILE: src/socket/checkers.handler.ts - FIXED
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
    const { roomId, from, to, sessionId, gameState, captured, mustContinue, winner } = data;
    const userId = socket.data.userId;

    try {
      console.log(`🎯 Checkers move from user ${userId}:`, { from, to, winner });

      const session = await GameSession.findById(sessionId);
      
      if (!session) {
        socket.emit('error', { message: 'Game session not found' });
        return;
      }

      // Verify it's player's turn
      if (session.currentTurn?.toString() !== userId) {
        console.log(`❌ Not player's turn. Current: ${session.currentTurn}, Attempted: ${userId}`);
        socket.emit('error', { message: 'Not your turn' });
        return;
      }

      // Verify player is in the game
      const isPlayer1 = session.players.player1.toString() === userId;
      const isPlayer2 = session.players.player2?.toString() === userId;
      
      if (!isPlayer1 && !isPlayer2) {
        socket.emit('error', { message: 'You are not a player in this game' });
        return;
      }

      const playerColor = isPlayer1 ? 'red' : 'black';

      // Add move to history
      session.moves.push({
        playerId: new mongoose.Types.ObjectId(userId),
        move: { from, to, color: playerColor, captured },
        timestamp: new Date(),
      });

      // Update game state from client
      session.gameState = gameState;

      // Check for game end
      if (winner) {
        console.log(`🏁 Game ended. Winner: ${winner}`);
        session.status = 'finished';
        session.finishedAt = new Date();
        
        const winnerId = winner === 'red' 
          ? session.players.player1 
          : session.players.player2;
        const loserId = winner === 'red' 
          ? session.players.player2 
          : session.players.player1;
        
        session.winner = winnerId;
        
        // Update winner stats
        await User.findByIdAndUpdate(winnerId, {
          $inc: { 
            'stats.gamesPlayed': 1,
            'stats.gamesWon': 1,
            'gameStats.checkers.wins': 1
          }
        });
        
        // Update loser stats
        if (loserId) {
          await User.findByIdAndUpdate(loserId, {
            $inc: { 
              'stats.gamesPlayed': 1,
              'stats.gamesLost': 1,
              'gameStats.checkers.losses': 1
            }
          });
        }
      } else {
        // Switch turn (unless must continue capture)
        if (!mustContinue) {
          session.currentTurn = isPlayer1 
            ? session.players.player2 
            : session.players.player1;
        }
      }

      await session.save();

      console.log(`✅ Move processed. Next turn: ${session.currentTurn}`);

      // Broadcast move to entire room
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

      // Clean up active games if finished
      if (session.status === 'finished') {
        activeGames.delete(session.players.player1.toString());
        if (session.players.player2) {
          activeGames.delete(session.players.player2.toString());
        }
        
        console.log(`🧹 Cleaned up finished game session: ${sessionId}`);
      }
    } catch (error) {
      console.error('❌ Checkers move error:', error);
      socket.emit('error', { 
        message: error instanceof Error ? error.message : 'Error processing move' 
      });
    }
  });
};