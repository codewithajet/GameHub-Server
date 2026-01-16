// ============================================
// src/socket/ticTacToe.handler.ts
// ============================================
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import GameSession from '../models/GameSession';
import User from '../models/User';

export const handleTicTacToe = (
  socket: Socket,
  io: Server,
  activeGames: Map<string, string>
) => {
  socket.on('tic-tac-toe:move', async (data) => {
    const { roomId, position, sessionId } = data;
    const userId = socket.data.userId;

    try {
      console.log(`\n🎯 Tic-Tac-Toe move from ${userId} at position ${position}`);
      
      const session = await GameSession.findById(sessionId);
      
      if (!session) {
        console.error('❌ Game session not found');
        socket.emit('error', { message: 'Game session not found' });
        return;
      }

      // Verify it's player's turn
      if (session.currentTurn?.toString() !== userId) {
        console.error('❌ Not player\'s turn');
        socket.emit('error', { message: 'Not your turn' });
        return;
      }

      // Initialize or get existing board
      if (!session.gameState.board) {
        session.gameState = { board: Array(9).fill(null) };
      }

      const board = session.gameState.board;
      
      console.log('📊 Current board state:', board);
      
      // Check if position is already taken
      if (board[position] !== null) {
        console.error('❌ Position already taken');
        socket.emit('error', { message: 'Invalid move - position already taken' });
        return;
      }

      // Determine player symbol
      const isPlayer1 = session.players.player1.toString() === userId;
      const symbol = isPlayer1 ? 'X' : 'O';
      
      console.log(`✅ Player ${isPlayer1 ? '1' : '2'} (${symbol}) making move at position ${position}`);
      
      // Update the board - IMPORTANT: Modify the existing board array
      board[position] = symbol;
      
      console.log('📊 Updated board state:', board);

      // Add move to history
      session.moves.push({
        playerId: new mongoose.Types.ObjectId(userId),
        move: { position, symbol },
        timestamp: new Date(),
      });

      // Check for winner
      const winner = checkTicTacToeWinner(board);
      
      console.log('🏆 Winner check result:', winner);
      
      if (winner) {
        session.status = 'finished';
        session.finishedAt = new Date();
        
        if (winner === 'TIE') {
          session.isDraw = true;
          // Update stats for both players
          await User.findByIdAndUpdate(session.players.player1, {
            $inc: { 
              'stats.gamesPlayed': 1,
              'stats.gamesTied': 1,
              'gameStats.ticTacToe.ties': 1
            }
          });
          await User.findByIdAndUpdate(session.players.player2, {
            $inc: { 
              'stats.gamesPlayed': 1,
              'stats.gamesTied': 1,
              'gameStats.ticTacToe.ties': 1
            }
          });
        } else {
          const winnerId = winner === 'X' ? session.players.player1 : session.players.player2;
          const loserId = winner === 'X' ? session.players.player2 : session.players.player1;
          
          session.winner = winnerId;
          
          // Update winner stats
          await User.findByIdAndUpdate(winnerId, {
            $inc: { 
              'stats.gamesPlayed': 1,
              'stats.gamesWon': 1,
              'gameStats.ticTacToe.wins': 1
            }
          });
          
          // Update loser stats
          await User.findByIdAndUpdate(loserId, {
            $inc: { 
              'stats.gamesPlayed': 1,
              'stats.gamesLost': 1,
              'gameStats.ticTacToe.losses': 1
            }
          });
        }
        
        session.gameState.winner = winner;
      } else {
        // Switch turn
        session.currentTurn = isPlayer1 ? session.players.player2 : session.players.player1;
      }

      // Save the session with updated board
      await session.save();
      
      console.log('💾 Session saved with board:', session.gameState.board);

      // Broadcast move to room - send the COMPLETE board state
      const moveData = {
        position,
        symbol,
        board: session.gameState.board, // Send complete board
        currentTurn: session.currentTurn?.toString(),
        winner: session.gameState.winner,
        gameOver: session.status === 'finished',
      };
      
      console.log('📤 Broadcasting move to room:', roomId);
      console.log('📦 Move data:', moveData);
      
      io.to(roomId).emit('tic-tac-toe:move-made', moveData);

      // Clean up active games if finished
      if (session.status === 'finished') {
        console.log('🏁 Game finished, cleaning up active games');
        activeGames.delete(session.players.player1.toString());
        if (session.players.player2) {
          activeGames.delete(session.players.player2.toString());
        }
      }
      
      console.log('✅ Move processed successfully\n');
    } catch (error) {
      console.error('❌ Tic-Tac-Toe move error:', error);
      socket.emit('error', { message: 'Error processing move' });
    }
  });
};

function checkTicTacToeWinner(board: any[]): 'X' | 'O' | 'TIE' | null {
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
    [0, 4, 8], [2, 4, 6], // Diagonals
  ];

  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  // Check for tie - all positions filled
  if (board.every((cell) => cell !== null)) {
    return 'TIE';
  }

  return null;
}