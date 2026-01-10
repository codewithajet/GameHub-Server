"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================
// FILE: src/server.ts
// ============================================
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const database_1 = __importDefault(require("./config/database"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const game_routes_1 = __importDefault(require("./routes/game.routes"));
const socketHandler_1 = require("./socket/socketHandler");
// Load environment variables
dotenv_1.default.config();
// Create Express app
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
// Initialize Socket.IO
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
});
// Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// API Routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api/games', game_routes_1.default);
// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'GameHub API is running',
        timestamp: new Date().toISOString(),
    });
});
// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
    });
});
// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
    });
});
// Initialize Socket.IO handlers
(0, socketHandler_1.initializeSocket)(io);
// Connect to database and start server
const PORT = process.env.PORT || 5000;
const startServer = async () => {
    try {
        await (0, database_1.default)();
        httpServer.listen(PORT, () => {
            console.log(`
╔════════════════════════════════════════╗
║                                        ║
║         🎮 GAMEHUB SERVER 🎮          ║
║                                        ║
║  Server running on port ${PORT}          ║
║  Environment: ${process.env.NODE_ENV || 'development'}              ║
║                                        ║
║  API Endpoints:                        ║
║  • POST /api/auth/register            ║
║  • POST /api/auth/login               ║
║  • GET  /api/auth/me                  ║
║  • POST /api/auth/logout              ║
║  • GET  /api/games/history            ║
║  • GET  /api/games/leaderboard        ║
║                                        ║
║  Socket.IO Events:                     ║
║  • find-match                         ║
║  • cancel-search                      ║
║  • tic-tac-toe:move                   ║
║  • chess:move                         ║
║  • checkers:move                      ║
║                                        ║
╚════════════════════════════════════════╝
      `);
        });
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server gracefully...');
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('SIGINT received. Closing server gracefully...');
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
exports.default = app;
//# sourceMappingURL=server.js.map