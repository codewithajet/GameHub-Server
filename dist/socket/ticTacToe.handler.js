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
    socket.on('tic-tac-toe:move', async (data) => {
        const { roomId, position, sessionId } = data;
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
            // Update game state
            if (!session.gameState.board) {
                session.gameState = { board: Array(9).fill(null) };
            }
            const board = session.gameState.board;
            if (board[position] !== null) {
                socket.emit('error', { message: 'Invalid move' });
                return;
            }
            // Determine player symbol
            const isPlayer1 = session.players.player1.toString() === userId;
            const symbol = isPlayer1 ? 'X' : 'O';
            board[position] = symbol;
            // Add move to history
            session.moves.push({
                playerId: new mongoose_1.default.Types.ObjectId(userId),
                move: { position, symbol },
                timestamp: new Date(),
            });
            // Check for winner
            const winner = checkTicTacToeWinner(board);
            if (winner) {
                session.status = 'finished';
                session.finishedAt = new Date();
                if (winner === 'TIE') {
                    session.isDraw = true;
                    // Update stats for both players
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
                }
                else {
                    const winnerId = winner === 'X' ? session.players.player1 : session.players.player2;
                    const loserId = winner === 'X' ? session.players.player2 : session.players.player1;
                    session.winner = winnerId;
                    // Update winner stats
                    await User_1.default.findByIdAndUpdate(winnerId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesWon': 1,
                            'gameStats.ticTacToe.wins': 1
                        }
                    });
                    // Update loser stats
                    await User_1.default.findByIdAndUpdate(loserId, {
                        $inc: {
                            'stats.gamesPlayed': 1,
                            'stats.gamesLost': 1,
                            'gameStats.ticTacToe.losses': 1
                        }
                    });
                }
                session.gameState.winner = winner;
            }
            else {
                // Switch turn
                session.currentTurn = isPlayer1 ? session.players.player2 : session.players.player1;
            }
            await session.save();
            // Broadcast move to room
            io.to(roomId).emit('tic-tac-toe:move-made', {
                position,
                symbol,
                board,
                currentTurn: session.currentTurn?.toString(),
                winner: session.gameState.winner,
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
            console.error('Tic-Tac-Toe move error:', error);
            socket.emit('error', { message: 'Error processing move' });
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
    if (board.every((cell) => cell !== null)) {
        return 'TIE';
    }
    return null;
}
//# sourceMappingURL=ticTacToe.handler.js.map