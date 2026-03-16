import mongoose, { Document } from 'mongoose';
export interface IUser extends Document {
    name: string;
    email: string;
    password?: string;
    avatar?: string;
    profilePicture?: string | null;
    googleId?: string;
    deviceId?: string;
    authProvider: 'local' | 'google';
    stats: {
        gamesPlayed: number;
        gamesWon: number;
        gamesLost: number;
        gamesTied: number;
    };
    gameStats: {
        ticTacToe: {
            wins: number;
            losses: number;
            ties: number;
        };
        chess: {
            wins: number;
            losses: number;
            ties: number;
        };
        checkers: {
            wins: number;
            losses: number;
            ties: number;
        };
    };
    isOnline: boolean;
    lastActive: Date;
    createdAt: Date;
    updatedAt: Date;
    comparePassword(candidatePassword: string): Promise<boolean>;
}
declare const _default: mongoose.Model<IUser, {}, {}, {}, mongoose.Document<unknown, {}, IUser, {}, mongoose.DefaultSchemaOptions> & IUser & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
} & {
    id: string;
}, any, IUser>;
export default _default;
//# sourceMappingURL=User.d.ts.map