"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCheckers = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const GameSession_1 = __importDefault(require("../models/GameSession"));
const User_1 = __importDefault(require("../models/User"));
const handleCheckers = (socket, io, activeGames) => {
    socket.on('checkers:move', async (data) => {
        const { roomId, from, to, sessionId, gameState, captured, mustContinue, winner } = data;
        const userId = socket.data.userId;
        try {
            console.log(`🎯 Checkers move from user ${userId}:`, { from, to, winner });
            const session = await GameSession_1.default.findById(sessionId);
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
                playerId: new mongoose_1.default.Types.ObjectId(userId),
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
                await User_1.default.findByIdAndUpdate(winnerId, {
                    $inc: {
                        'stats.gamesPlayed': 1,
                        'stats.gamesWon': 1,
                        'gameStats.checkers.wins': 1
                    }
                });
                // Update loser stats
                if (loserId) {
                    await User_1.default.findByIdAndUpdate(loserId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesLost': 1,
                            'gameStats.checkers.losses': 1
                        }
                    });
                }
            }
            else {
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
        }
        catch (error) {
            console.error('❌ Checkers move error:', error);
            socket.emit('error', {
                message: error instanceof Error ? error.message : 'Error processing move'
            });
        }
    });
    // Handle disconnect during checkers game
    socket.on('disconnect', async () => {
        const userId = socket.data.userId;
        try {
            // Find active checkers game for this user
            const activeSession = await GameSession_1.default.findOne({
                $or: [
                    { 'players.player1': userId },
                    { 'players.player2': userId }
                ],
                gameType: 'checkers',
                status: 'active'
            });
            if (activeSession) {
                console.log(`👋 Player disconnected from checkers game: ${userId}`);
                // Determine opponent
                const isPlayer1 = activeSession.players.player1.toString() === userId;
                const opponentId = isPlayer1
                    ? activeSession.players.player2
                    : activeSession.players.player1;
                // Mark game as finished with opponent as winner
                activeSession.status = 'finished';
                activeSession.finishedAt = new Date();
                activeSession.winner = opponentId;
                await activeSession.save();
                // Update stats
                if (opponentId) {
                    await User_1.default.findByIdAndUpdate(opponentId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesWon': 1,
                            'gameStats.checkers.wins': 1
                        }
                    });
                }
                await User_1.default.findByIdAndUpdate(userId, {
                    $inc: {
                        'stats.gamesPlayed': 1,
                        'stats.gamesLost': 1,
                        'gameStats.checkers.losses': 1
                    }
                });
                // Notify opponent
                if (activeSession.roomId) {
                    io.to(activeSession.roomId).emit('opponent-disconnected', {
                        message: 'Your opponent has disconnected. You win!',
                        winner: isPlayer1 ? 'black' : 'red'
                    });
                }
                // Clean up
                activeGames.delete(userId);
                if (opponentId) {
                    activeGames.delete(opponentId.toString());
                }
            }
        }
        catch (error) {
            console.error('Error handling checkers disconnect:', error);
        }
    });
    // Handle explicit game leave
    socket.on('leave-game', async () => {
        const userId = socket.data.userId;
        try {
            const activeSession = await GameSession_1.default.findOne({
                $or: [
                    { 'players.player1': userId },
                    { 'players.player2': userId }
                ],
                gameType: 'checkers',
                status: 'active'
            });
            if (activeSession) {
                console.log(`🚪 Player leaving checkers game: ${userId}`);
                const isPlayer1 = activeSession.players.player1.toString() === userId;
                const opponentId = isPlayer1
                    ? activeSession.players.player2
                    : activeSession.players.player1;
                activeSession.status = 'finished';
                activeSession.finishedAt = new Date();
                activeSession.winner = opponentId;
                await activeSession.save();
                // Update stats
                if (opponentId) {
                    await User_1.default.findByIdAndUpdate(opponentId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesWon': 1,
                            'gameStats.checkers.wins': 1
                        }
                    });
                }
                await User_1.default.findByIdAndUpdate(userId, {
                    $inc: {
                        'stats.gamesPlayed': 1,
                        'stats.gamesLost': 1,
                        'gameStats.checkers.losses': 1
                    }
                });
                if (activeSession.roomId) {
                    socket.to(activeSession.roomId).emit('opponent-disconnected', {
                        message: 'Your opponent has left the game. You win by forfeit!',
                        winner: isPlayer1 ? 'black' : 'red'
                    });
                    socket.leave(activeSession.roomId);
                }
                activeGames.delete(userId);
                if (opponentId) {
                    activeGames.delete(opponentId.toString());
                }
            }
        }
        catch (error) {
            console.error('Error handling leave-game:', error);
        }
    });
};
exports.handleCheckers = handleCheckers;
//# sourceMappingURL=checkers.handler.js.map