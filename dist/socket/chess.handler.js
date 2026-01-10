"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleChess = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const GameSession_1 = __importDefault(require("../models/GameSession"));
const User_1 = __importDefault(require("../models/User"));
const handleChess = (socket, io, activeGames) => {
    socket.on('chess:move', async (data) => {
        const { roomId, from, to, sessionId } = data;
        const userId = socket.data.userId;
        try {
            const session = await GameSession_1.default.findById(sessionId);
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
            const playerColor = isPlayer1 ? 'white' : 'black';
            // Add move to history
            session.moves.push({
                playerId: new mongoose_1.default.Types.ObjectId(userId),
                move: { from, to, color: playerColor },
                timestamp: new Date(),
            });
            // Update game state (client handles validation)
            session.gameState = data.gameState;
            // Check for game end
            if (data.winner) {
                session.status = 'finished';
                session.finishedAt = new Date();
                if (data.winner === 'draw') {
                    session.isDraw = true;
                    // Update stats for both players
                    await User_1.default.findByIdAndUpdate(session.players.player1, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesTied': 1,
                            'gameStats.chess.ties': 1
                        }
                    });
                    await User_1.default.findByIdAndUpdate(session.players.player2, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesTied': 1,
                            'gameStats.chess.ties': 1
                        }
                    });
                }
                else {
                    const winnerId = data.winner === 'white' ? session.players.player1 : session.players.player2;
                    const loserId = data.winner === 'white' ? session.players.player2 : session.players.player1;
                    session.winner = winnerId;
                    await User_1.default.findByIdAndUpdate(winnerId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesWon': 1,
                            'gameStats.chess.wins': 1
                        }
                    });
                    await User_1.default.findByIdAndUpdate(loserId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesLost': 1,
                            'gameStats.chess.losses': 1
                        }
                    });
                }
            }
            else {
                // Switch turn
                session.currentTurn = isPlayer1 ? session.players.player2 : session.players.player1;
            }
            await session.save();
            // Broadcast move to room
            io.to(roomId).emit('chess:move-made', {
                from,
                to,
                gameState: session.gameState,
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
        }
        catch (error) {
            console.error('Chess move error:', error);
            socket.emit('error', { message: 'Error processing move' });
        }
    });
    // Handle pawn promotion
    socket.on('chess:promote', async (data) => {
        const { roomId, sessionId, position, pieceType } = data;
        io.to(roomId).emit('chess:piece-promoted', {
            position,
            pieceType,
        });
    });
};
exports.handleChess = handleChess;
//# sourceMappingURL=chess.handler.js.map