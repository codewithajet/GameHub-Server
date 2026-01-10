import { Request } from 'express';
import { IUser } from '../models/User';
export interface AuthRequest extends Request {
    user?: IUser;
    userId?: string;
}
export interface SocketUser {
    userId: string;
    socketId: string;
    username: string;
}
export interface GameRoom {
    roomId: string;
    gameType: 'tic-tac-toe' | 'chess' | 'checkers';
    players: SocketUser[];
    gameState: any;
    currentTurn: string;
}
export type TicTacToePlayer = 'X' | 'O' | null;
export type TicTacToeBoard = TicTacToePlayer[];
export interface TicTacToeState {
    board: TicTacToeBoard;
    currentPlayer: 'X' | 'O';
    winner: TicTacToePlayer | 'TIE' | null;
}
export type ChessPieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type ChessColor = 'white' | 'black';
export interface ChessPiece {
    type: ChessPieceType;
    color: ChessColor;
    hasMoved?: boolean;
}
export type ChessBoard = (ChessPiece | null)[][];
export interface ChessState {
    board: ChessBoard;
    currentPlayer: ChessColor;
    winner: ChessColor | 'draw' | null;
    capturedPieces: {
        white: ChessPiece[];
        black: ChessPiece[];
    };
}
export type CheckersColor = 'red' | 'black';
export interface CheckersPiece {
    color: CheckersColor;
    isKing: boolean;
}
export type CheckersBoard = (CheckersPiece | null)[][];
export interface CheckersState {
    board: CheckersBoard;
    currentPlayer: CheckersColor;
    winner: CheckersColor | null;
    capturedPieces: {
        red: number;
        black: number;
    };
}
//# sourceMappingURL=index.d.ts.map