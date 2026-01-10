// ============================================
// FILE: src/server.ts
// ============================================
import express, { Application, Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import connectDB from './config/database';
import authRoutes from './routes/auth.routes';
import gameRoutes from './routes/game.routes';
import { initializeSocket } from './socket/socketHandler';

// Load environment variables
dotenv.config();

// Create Express app
const app: Application = express();
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'GameHub API is running',
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// Initialize Socket.IO handlers
initializeSocket(io);

// Connect to database and start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    
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
  } catch (error) {
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

export default app;