// ============================================
// FIXED: src/socket/ticTacToe.handler.ts
// Added proper game reset handling
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
  
  // Handle game reset
  socket.on('tic-tac-toe:reset', async (data) => {
    const { roomId, sessionId } = data;
    const userId = socket.data.userId;

    try {
      console.log(`\n🔄 Tic-Tac-Toe reset requested by ${userId}`);
      
      const session = await GameSession.findById(sessionId);
      
      if (!session) {
        console.error('❌ Game session not found');
        socket.emit('error', { message: 'Game session not found' });
        return;
      }

      // Verify user is part of this game
      const isPlayer1 = session.players.player1.toString() === userId;
      const isPlayer2 = session.players.player2?.toString() === userId;
      
      if (!isPlayer1 && !isPlayer2) {
        console.error('❌ User not part of this game');
        socket.emit('error', { message: 'Not authorized' });
        return;
      }

      // Reset the game state
      const resetUpdate = {
        $set: {
          'gameState.board': Array(9).fill(null),
          'gameState.winner': null,
          'status': 'active',
          'currentTurn': session.players.player1, // Player 1 (X) always starts
          'isDraw': false,
          'finishedAt': null
        },
        $push: {
          moves: {
            playerId: new mongoose.Types.ObjectId(userId),
            move: { type: 'reset' },
            timestamp: new Date(),
          }
        }
      };

      const updatedSession = await GameSession.findByIdAndUpdate(
        sessionId,
        resetUpdate,
        { new: true }
      );

      if (!updatedSession) {
        throw new Error('Failed to reset session');
      }

      console.log('✅ Game reset successfully');
      console.log('📊 Reset board:', updatedSession.gameState.board);

      // Broadcast reset to room
      io.to(roomId).emit('tic-tac-toe:reset', {
        board: updatedSession.gameState.board,
        currentTurn: updatedSession.currentTurn?.toString(),
        sessionId: sessionId
      });

      console.log('📤 Reset broadcast to room:', roomId);
      
    } catch (error) {
      console.error('❌ Tic-Tac-Toe reset error:', error);
      socket.emit('error', { message: 'Error resetting game' });
    }
  });

  socket.on('tic-tac-toe:move', async (data) => {
    const { roomId, position, sessionId } = data;
    const userId = socket.data.userId;

    try {
      console.log(`\n🎯 Tic-Tac-Toe move from ${userId} at position ${position}`);
      
      let session = await GameSession.findById(sessionId);
      
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

      // Initialize board if it doesn't exist
      let currentBoard: any[];
      if (!session.gameState || !session.gameState.board) {
        currentBoard = Array(9).fill(null);
      } else {
        // Create a proper copy of the board
        currentBoard = JSON.parse(JSON.stringify(session.gameState.board));
      }
      
      console.log('📊 Current board state:', currentBoard);
      
      // Check if position is already taken
      if (currentBoard[position] !== null && currentBoard[position] !== undefined) {
        console.error('❌ Position already taken');
        socket.emit('error', { message: 'Invalid move - position already taken' });
        return;
      }

      // Determine player symbol
      const isPlayer1 = session.players.player1.toString() === userId;
      const symbol = isPlayer1 ? 'X' : 'O';
      
      console.log(`✅ Player ${isPlayer1 ? '1' : '2'} (${symbol}) making move at position ${position}`);
      
      // Update the board
      currentBoard[position] = symbol;
      
      console.log('📊 Updated board state:', currentBoard);

      // Check for winner
      const winner = checkTicTacToeWinner(currentBoard);
      console.log('🏆 Winner check result:', winner);

      // Prepare update object
      const updateObj: any = {
        $set: {
          'gameState.board': currentBoard
        },
        $push: {
          moves: {
            playerId: new mongoose.Types.ObjectId(userId),
            move: { position, symbol },
            timestamp: new Date(),
          }
        }
      };

      // Handle game end or turn switch
      if (winner) {
        updateObj.$set.status = 'finished';
        updateObj.$set.finishedAt = new Date();
        
        if (winner === 'TIE') {
          updateObj.$set.isDraw = true;
          updateObj.$set['gameState.winner'] = 'TIE';
          
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
          
          updateObj.$set.winner = winnerId;
          updateObj.$set['gameState.winner'] = winner;
          
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
      } else {
        // Switch turn
        updateObj.$set.currentTurn = isPlayer1 ? session.players.player2 : session.players.player1;
      }

      // CRITICAL: Use findByIdAndUpdate with $set to directly update MongoDB
      const updatedSession = await GameSession.findByIdAndUpdate(
        sessionId,
        updateObj,
        { new: true } // Return the updated document
      );

      if (!updatedSession) {
        throw new Error('Failed to update session');
      }

      console.log('💾 Session updated successfully');
      console.log('💾 Final board in database:', updatedSession.gameState.board);

      // Broadcast move to room
      const moveData = {
        position,
        symbol,
        board: updatedSession.gameState.board,
        currentTurn: updatedSession.currentTurn?.toString(),
        winner: updatedSession.gameState?.winner,
        gameOver: updatedSession.status === 'finished',
      };
      
      console.log('📤 Broadcasting to room:', roomId);
      console.log('📦 Board being sent:', moveData.board);
      
      io.to(roomId).emit('tic-tac-toe:move-made', moveData);

      // Clean up active games if finished
      if (updatedSession.status === 'finished') {
        console.log('🏁 Game finished, cleaning up');
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

  // Check for tie
  if (board.every((cell) => cell !== null && cell !== undefined)) {
    return 'TIE';
  }

  return null;
}