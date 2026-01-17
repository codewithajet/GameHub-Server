"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleTicTacToe = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const GameSession_1 = __importDefault(require("../models/GameSession"));
const User_1 = __importDefault(require("../models/User"));
const handleTicTacToe = (socket, io, activeGames) => {
    // Handle game reset
    socket.on('tic-tac-toe:reset', async (data) => {
        const { roomId, sessionId } = data;
        const userId = socket.data.userId;
        try {
            console.log(`\n🔄 Tic-Tac-Toe reset requested by ${userId}`);
            const session = await GameSession_1.default.findById(sessionId);
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
            console.log('🎯 Player1 ID:', session.players.player1.toString());
            console.log('🎯 Player2 ID:', session.players.player2?.toString());
            console.log('🎯 Resetting - currentTurn will be set to Player1');
            // Reset the game state - Player 1 (X) always goes first
            const resetUpdate = {
                $set: {
                    'gameState.board': Array(9).fill(null),
                    'gameState.winner': null,
                    'status': 'active',
                    'currentTurn': session.players.player1,
                    'isDraw': false,
                    'finishedAt': null
                }
            };
            const updatedSession = await GameSession_1.default.findByIdAndUpdate(sessionId, resetUpdate, { new: true });
            if (!updatedSession) {
                throw new Error('Failed to reset session');
            }
            console.log('✅ Game reset successfully');
            console.log('📊 Reset board:', updatedSession.gameState.board);
            console.log('👤 Current turn set to:', updatedSession.currentTurn?.toString());
            // Broadcast reset to room with currentTurn
            const resetData = {
                board: updatedSession.gameState.board,
                currentTurn: updatedSession.currentTurn?.toString(),
                sessionId: sessionId
            };
            console.log('📤 Broadcasting reset to room:', roomId);
            console.log('📦 Reset data:', resetData);
            io.to(roomId).emit('tic-tac-toe:reset', resetData);
        }
        catch (error) {
            console.error('❌ Tic-Tac-Toe reset error:', error);
            socket.emit('error', { message: 'Error resetting game' });
        }
    });
    socket.on('tic-tac-toe:move', async (data) => {
        const { roomId, position, sessionId } = data;
        const userId = socket.data.userId;
        try {
            console.log(`\n🎯 Tic-Tac-Toe move from ${userId} at position ${position}`);
            let session = await GameSession_1.default.findById(sessionId);
            if (!session) {
                console.error('❌ Game session not found');
                socket.emit('error', { message: 'Game session not found' });
                return;
            }
            console.log('🔍 Current turn:', session.currentTurn?.toString());
            console.log('🔍 Player making move:', userId);
            console.log('🔍 Game status:', session.status);
            // CRITICAL: Check if game is already finished to prevent double scoring
            if (session.status === 'finished') {
                console.error('❌ Game already finished, ignoring move');
                socket.emit('error', { message: 'Game already finished' });
                return;
            }
            // Verify it's player's turn
            if (session.currentTurn?.toString() !== userId) {
                console.error('❌ Not player\'s turn');
                socket.emit('error', { message: 'Not your turn' });
                return;
            }
            // Initialize board if it doesn't exist
            let currentBoard;
            if (!session.gameState || !session.gameState.board) {
                currentBoard = Array(9).fill(null);
            }
            else {
                currentBoard = JSON.parse(JSON.stringify(session.gameState.board));
            }
            console.log('📊 Current board state:', currentBoard);
            // Check if position is already taken
            if (currentBoard[position] !== null && currentBoard[position] !== undefined) {
                console.error('❌ Position already taken');
                console.error('❌ Position value:', currentBoard[position]);
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
            const updateObj = {
                $set: {
                    'gameState.board': currentBoard
                },
                $push: {
                    moves: {
                        playerId: new mongoose_1.default.Types.ObjectId(userId),
                        move: { position, symbol },
                        timestamp: new Date(),
                    }
                }
            };
            // Handle game end or turn switch
            if (winner) {
                console.log('🏁 Game is ending with winner:', winner);
                updateObj.$set.status = 'finished';
                updateObj.$set.finishedAt = new Date();
                if (winner === 'TIE') {
                    updateObj.$set.isDraw = true;
                    updateObj.$set['gameState.winner'] = 'TIE';
                    console.log('📊 Game ended in TIE - updating stats ONCE');
                    // FIXED: Update stats for both players - TIE (happens once per game)
                    await User_1.default.findByIdAndUpdate(session.players.player1, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesTied': 1,
                            'gameStats.ticTacToe.ties': 1
                        }
                    });
                    await User_1.default.findByIdAndUpdate(session.players.player2, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesTied': 1,
                            'gameStats.ticTacToe.ties': 1
                        }
                    });
                    console.log('✅ Updated TIE stats for both players');
                }
                else {
                    const winnerId = winner === 'X' ? session.players.player1 : session.players.player2;
                    const loserId = winner === 'X' ? session.players.player2 : session.players.player1;
                    updateObj.$set.winner = winnerId;
                    updateObj.$set['gameState.winner'] = winner;
                    console.log(`📊 Game won by ${winner} - Winner ID: ${winnerId}`);
                    // FIXED: Update winner stats ONCE
                    await User_1.default.findByIdAndUpdate(winnerId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesWon': 1,
                            'gameStats.ticTacToe.wins': 1
                        }
                    });
                    console.log('✅ Updated winner stats');
                    // FIXED: Update loser stats ONCE
                    await User_1.default.findByIdAndUpdate(loserId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesLost': 1,
                            'gameStats.ticTacToe.losses': 1
                        }
                    });
                    console.log('✅ Updated loser stats');
                }
            }
            else {
                // Switch turn only if game not finished
                const nextTurn = isPlayer1 ? session.players.player2 : session.players.player1;
                if (nextTurn) {
                    updateObj.$set.currentTurn = nextTurn;
                    console.log('🔄 Switching turn to:', nextTurn.toString());
                }
            }
            // CRITICAL: Use findByIdAndUpdate with $set to directly update MongoDB
            const updatedSession = await GameSession_1.default.findByIdAndUpdate(sessionId, updateObj, { new: true });
            if (!updatedSession) {
                throw new Error('Failed to update session');
            }
            console.log('💾 Session updated successfully');
            console.log('💾 Final board in database:', updatedSession.gameState.board);
            console.log('💾 Game status:', updatedSession.status);
            console.log('👤 Next turn:', updatedSession.currentTurn?.toString());
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
            console.log('📦 Move data being sent:', moveData);
            // CRITICAL: Broadcast to room (both players will receive this)
            io.to(roomId).emit('tic-tac-toe:move-made', moveData);
            // Clean up active games if finished
            if (updatedSession.status === 'finished') {
                console.log('🏁 Game finished, cleaning up active games map');
                activeGames.delete(session.players.player1.toString());
                if (session.players.player2) {
                    activeGames.delete(session.players.player2.toString());
                }
            }
            console.log('✅ Move processed successfully\n');
        }
        catch (error) {
            console.error('❌ Tic-Tac-Toe move error:', error);
            socket.emit('error', { message: 'Error processing move' });
        }
    });
    // Handle player leaving/disconnecting
    socket.on('leave-game', async () => {
        const userId = socket.data.userId;
        console.log(`\n👋 User ${userId} leaving game`);
        try {
            // Find active session for this user
            const session = await GameSession_1.default.findOne({
                $or: [
                    { 'players.player1': userId },
                    { 'players.player2': userId }
                ],
                status: 'active',
                gameType: 'tic-tac-toe'
            });
            if (session) {
                const roomId = `game:${session._id}`;
                const isPlayer1 = session.players.player1.toString() === userId;
                const opponentId = isPlayer1 ? session.players.player2 : session.players.player1;
                console.log(`📢 Notifying opponent about disconnect - Room: ${roomId}`);
                // Get opponent name
                const leavingUser = await User_1.default.findById(userId);
                // Notify opponent
                io.to(roomId).emit('opponent-disconnected', {
                    message: `${leavingUser?.name || 'Your opponent'} has left the game`,
                    opponentLeft: true
                });
                // Mark session as abandoned
                await GameSession_1.default.findByIdAndUpdate(session._id, {
                    $set: {
                        status: 'abandoned',
                        finishedAt: new Date()
                    }
                });
                // Clean up active games
                activeGames.delete(session.players.player1.toString());
                if (session.players.player2) {
                    activeGames.delete(session.players.player2.toString());
                }
                // Leave the socket room
                socket.leave(roomId);
                console.log('✅ User successfully left game');
            }
        }
        catch (error) {
            console.error('❌ Error handling leave-game:', error);
        }
    });
    // Handle socket disconnect
    socket.on('disconnect', async () => {
        const userId = socket.data.userId;
        console.log(`\n🔌 User ${userId} disconnected`);
        try {
            // Find active session for this user
            const session = await GameSession_1.default.findOne({
                $or: [
                    { 'players.player1': userId },
                    { 'players.player2': userId }
                ],
                status: 'active',
                gameType: 'tic-tac-toe'
            });
            if (session) {
                const roomId = `game:${session._id}`;
                console.log(`📢 User disconnected mid-game - notifying opponent in room: ${roomId}`);
                // Get username
                const disconnectedUser = await User_1.default.findById(userId);
                // Notify opponent about disconnection
                io.to(roomId).emit('opponent-disconnected', {
                    message: `${disconnectedUser?.name || 'Your opponent'} has disconnected`,
                    opponentLeft: true
                });
                // Mark session as abandoned
                await GameSession_1.default.findByIdAndUpdate(session._id, {
                    $set: {
                        status: 'abandoned',
                        finishedAt: new Date()
                    }
                });
                // Clean up active games
                activeGames.delete(session.players.player1.toString());
                if (session.players.player2) {
                    activeGames.delete(session.players.player2.toString());
                }
                console.log('✅ Handled disconnect cleanup');
            }
        }
        catch (error) {
            console.error('❌ Error handling disconnect:', error);
        }
    });
};
exports.handleTicTacToe = handleTicTacToe;
function checkTicTacToeWinner(board) {
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
//# sourceMappingURL=ticTacToe.handler.js.map