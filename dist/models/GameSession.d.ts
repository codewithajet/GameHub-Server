import mongoose, { Document } from 'mongoose';
export type GameType = 'tic-tac-toe' | 'chess' | 'checkers';
export type GameStatus = 'waiting' | 'playing' | 'finished' | 'abandoned';
export interface IGameSession extends Document {
    gameType: GameType;
    status: GameStatus;
    players: {
        player1: mongoose.Types.ObjectId;
        player2?: mongoose.Types.ObjectId;
    };
    currentTurn?: mongoose.Types.ObjectId;
    gameState: any;
    winner?: mongoose.Types.ObjectId;
    isDraw: boolean;
    moves: Array<{
        playerId: mongoose.Types.ObjectId;
        move: any;
        timestamp: Date;
    }>;
    startedAt?: Date;
    finishedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
declare const _default: mongoose.Model<IGameSession, {}, {}, {}, mongoose.Document<unknown, {}, IGameSession, {}, mongoose.DefaultSchemaOptions> & IGameSession & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, IGameSession>;
export default _default;
//# sourceMappingURL=GameSession.d.ts.map