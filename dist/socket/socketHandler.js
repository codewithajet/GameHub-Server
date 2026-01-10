"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocket = initializeSocket;
const mongoose_1 = __importDefault(require("mongoose"));
const jwt_utils_1 = require("../utils/jwt.utils");
const User_1 = __importDefault(require("../models/User"));
const GameSession_1 = __importDefault(require("../models/GameSession"));
const ticTacToe_handler_1 = require("./ticTacToe.handler");
const chess_handler_1 = require("./chess.handler");
const checkers_handler_1 = require("./checkers.handler");
// In-memory storage for active connections and waiting queues
const connectedUsers = new Map();
const waitingQueue = new Map(); // gameType -> players[]
const activeGames = new Map(); // userId -> roomId
function initializeSocket(io) {
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentication error'));
            }
            const decoded = (0, jwt_utils_1.verifyToken)(token);
            const user = await User_1.default.findById(decoded.id);
            if (!user) {
                return next(new Error('User not found'));
            }
            socket.data.userId = user._id.toString();
            socket.data.username = user.name;
            next();
        }
        catch (error) {
            next(new Error('Authentication error'));
        }
    });
    io.on('connection', (socket) => {
        const userId = socket.data.userId;
        const username = socket.data.username;
        console.log(`✅ User connected: ${username} (${userId})`);
        // Store connected user
        connectedUsers.set(userId, {
            userId,
            socketId: socket.id,
            username,
        });
        // Update user online status
        User_1.default.findByIdAndUpdate(userId, {
            isOnline: true,
            lastActive: new Date(),
        }).exec();
        // Send connection confirmation
        socket.emit('connected', {
            userId,
            username,
            message: 'Connected to GameHub',
        });
        // ===================================
        // MATCHMAKING
        // ===================================
        socket.on('find-match', async ({ gameType }) => {
            console.log(`🔍 ${username} searching for ${gameType} match...`);
            // Check if user already in a game
            if (activeGames.has(userId)) {
                socket.emit('error', { message: 'Already in an active game' });
                return;
            }
            // Initialize queue for this game type
            if (!waitingQueue.has(gameType)) {
                waitingQueue.set(gameType, []);
            }
            const queue = waitingQueue.get(gameType);
            // Check if player already in queue
            const alreadyInQueue = queue.find((p) => p.userId === userId);
            if (alreadyInQueue) {
                socket.emit('error', { message: 'Already searching for a match' });
                return;
            }
            // Check if someone is waiting
            if (queue.length > 0) {
                const opponent = queue.shift();
                // Don't match with yourself
                if (opponent.userId === userId) {
                    queue.push({ userId, socketId: socket.id, username, gameType });
                    return;
                }
                // Create game room
                const roomId = `${gameType}-${Date.now()}`;
                socket.join(roomId);
                io.sockets.sockets.get(opponent.socketId)?.join(roomId);
                // Store active game
                activeGames.set(userId, roomId);
                activeGames.set(opponent.userId, roomId);
                // Create game session in database
                const gameSession = await GameSession_1.default.create({
                    gameType,
                    status: 'playing',
                    players: {
                        player1: new mongoose_1.default.Types.ObjectId(userId),
                        player2: new mongoose_1.default.Types.ObjectId(opponent.userId),
                    },
                    currentTurn: new mongoose_1.default.Types.ObjectId(userId), // Player 1 starts
                    startedAt: new Date(),
                });
                // Notify both players
                io.to(roomId).emit('match-found', {
                    roomId,
                    gameType,
                    sessionId: gameSession._id,
                    players: [
                        { userId, username, role: 'player1' },
                        { userId: opponent.userId, username: opponent.username, role: 'player2' },
                    ],
                    currentTurn: userId,
                });
                console.log(`🎮 Match created: ${username} vs ${opponent.username}`);
            }
            else {
                // Add to waiting queue
                queue.push({ userId, socketId: socket.id, username, gameType });
                socket.emit('searching', {
                    message: 'Searching for opponent...',
                    queuePosition: queue.length
                });
            }
        });
        // Cancel matchmaking
        socket.on('cancel-search', ({ gameType }) => {
            const queue = waitingQueue.get(gameType);
            if (queue) {
                const index = queue.findIndex((p) => p.userId === userId);
                if (index !== -1) {
                    queue.splice(index, 1);
                    socket.emit('search-cancelled', { message: 'Search cancelled' });
                }
            }
        });
        // ===================================
        // GAME HANDLERS
        // ===================================
        (0, ticTacToe_handler_1.handleTicTacToe)(socket, io, activeGames);
        (0, chess_handler_1.handleChess)(socket, io, activeGames);
        (0, checkers_handler_1.handleCheckers)(socket, io, activeGames);
        // ===================================
        // DISCONNECT
        // ===================================
        socket.on('disconnect', async () => {
            console.log(`❌ User disconnected: ${username}`);
            // Remove from connected users
            connectedUsers.delete(userId);
            // Remove from all waiting queues
            waitingQueue.forEach((queue, gameType) => {
                const index = queue.findIndex((p) => p.userId === userId);
                if (index !== -1) {
                    queue.splice(index, 1);
                }
            });
            // Handle active game abandonment
            const roomId = activeGames.get(userId);
            if (roomId) {
                socket.to(roomId).emit('opponent-disconnected', {
                    message: 'Opponent disconnected',
                });
                activeGames.delete(userId);
            }
            // Update user status
            await User_1.default.findByIdAndUpdate(userId, {
                isOnline: false,
                lastActive: new Date(),
            });
        });
    });
}
;
//# sourceMappingURL=socketHandler.js.map