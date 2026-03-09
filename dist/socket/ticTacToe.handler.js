import mongoose from 'mongoose';
import GameSession from '../models/GameSession';
import User from '../models/User';
export const handleTicTacToe = (socket, io, activeGames) => {
    socket.on('tic-tac-toe:move', async (data) => {
        const { roomId, position, sessionId } = data;
        const userId = socket.data.userId;
        try {
            console.log(`🎯 Tic-Tac-Toe move from user ${userId}: position ${position}`);
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
            const playerSymbol = isPlayer1 ? 'X' : 'O';
            // CRITICAL FIX: Get current board state from session
            let board = Array.isArray(session.gameState?.board)
                ? [...session.gameState.board]
                : Array(9).fill(null);
            console.log('📋 Current board before move:', board);
            // Validate move - check if position is already occupied
            if (board[position] !== null) {
                console.log(`❌ Position ${position} already taken with ${board[position]}`);
                socket.emit('error', { message: 'Invalid move: position already taken' });
                return;
            }
            // CRITICAL FIX: Make the move on the existing board
            board[position] = playerSymbol;
            console.log('📋 Board after move:', board);
            // Add move to history
            session.moves.push({
                playerId: new mongoose.Types.ObjectId(userId),
                move: { position, symbol: playerSymbol },
                timestamp: new Date(),
            });
            // Check for winner
            const winner = checkWinner(board);
            // CRITICAL FIX: Update game state with the modified board
            session.gameState = { board: board };
            if (winner) {
                console.log(`🏁 Game ended. Winner: ${winner}`);
                session.status = 'finished';
                session.finishedAt = new Date();
                if (winner === 'TIE') {
                    session.isDraw = true;
                    // Update stats for both players
                    await User.findByIdAndUpdate(session.players.player1, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesTied': 1,
                            'gameStats.tic-tac-toe.ties': 1
                        }
                    });
                    if (session.players.player2) {
                        await User.findByIdAndUpdate(session.players.player2, {
                            $inc: {
                                'stats.gamesPlayed': 1,
                                'stats.gamesTied': 1,
                                'gameStats.tic-tac-toe.ties': 1
                            }
                        });
                    }
                }
                else {
                    // Determine winner ID based on symbol
                    const winnerId = winner === 'X'
                        ? session.players.player1
                        : session.players.player2;
                    const loserId = winner === 'X'
                        ? session.players.player2
                        : session.players.player1;
                    session.winner = winnerId;
                    // Update winner stats
                    await User.findByIdAndUpdate(winnerId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesWon': 1,
                            'gameStats.tic-tac-toe.wins': 1
                        }
                    });
                    // Update loser stats
                    if (loserId) {
                        await User.findByIdAndUpdate(loserId, {
                            $inc: {
                                'stats.gamesPlayed': 1,
                                'stats.gamesLost': 1,
                                'gameStats.tic-tac-toe.losses': 1
                            }
                        });
                    }
                }
            }
            else {
                // Switch turn to other player
                session.currentTurn = isPlayer1
                    ? session.players.player2
                    : session.players.player1;
            }
            await session.save();
            console.log(`✅ Move processed. Board:`, session.gameState.board);
            console.log(`✅ Next turn: ${session.currentTurn}`);
            // Broadcast move to entire room
            io.to(roomId).emit('tic-tac-toe:move-made', {
                board: session.gameState.board, // Send the complete updated board
                position,
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
        }
        catch (error) {
            console.error('❌ Tic-Tac-Toe move error:', error);
            socket.emit('error', {
                message: error instanceof Error ? error.message : 'Error processing move'
            });
        }
    });
    // Handle game reset
    socket.on('tic-tac-toe:reset', async (data) => {
        const { roomId, sessionId } = data;
        const userId = socket.data.userId;
        try {
            console.log(`🔄 Reset request from user ${userId}`);
            const session = await GameSession.findById(sessionId);
            if (!session) {
                socket.emit('error', { message: 'Game session not found' });
                return;
            }
            // Verify player is in the game
            const isPlayer1 = session.players.player1.toString() === userId;
            const isPlayer2 = session.players.player2?.toString() === userId;
            if (!isPlayer1 && !isPlayer2) {
                socket.emit('error', { message: 'You are not a player in this game' });
                return;
            }
            // Reset game state
            session.gameState = { board: Array(9).fill(null) };
            session.status = 'active';
            session.currentTurn = session.players.player1; // Player 1 always starts
            session.winner = undefined;
            session.isDraw = false;
            session.moves = [];
            session.finishedAt = undefined;
            await session.save();
            console.log('✅ Game reset successfully. Board:', session.gameState.board);
            // Broadcast reset to room
            io.to(roomId).emit('tic-tac-toe:reset', {
                board: session.gameState.board,
                currentTurn: session.currentTurn?.toString(),
            });
        }
        catch (error) {
            console.error('❌ Reset error:', error);
            socket.emit('error', {
                message: error instanceof Error ? error.message : 'Error resetting game'
            });
        }
    });
};
// Helper function to check for winner
function checkWinner(board) {
    const winningCombos = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6], // Diagonals
    ];
    // Check for winner
    for (const combo of winningCombos) {
        const [a, b, c] = combo;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    // Check for tie
    if (board.every((cell) => cell !== null)) {
        return 'TIE';
    }
    return null;
}
//# sourceMappingURL=ticTacToe.handler.js.map