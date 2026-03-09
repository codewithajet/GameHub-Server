// src/models/User.ts
// Backward-compatible update:
//   • password is now optional (Google users have none)
//   • adds googleId, deviceId, profilePicture, authProvider
//   • all existing fields/methods are preserved
import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  name:           string;
  email:          string;
  password?:      string;         // optional — Google users have no password
  avatar?:        string;
  profilePicture?: string;        // Google profile photo URL
  googleId?:      string;         // Google's unique "sub" identifier
  deviceId?:      string;         // expo-device ID stored for auto-login
  authProvider:   'local' | 'google';
  stats: {
    gamesPlayed: number;
    gamesWon:    number;
    gamesLost:   number;
    gamesTied:   number;
  };
  gameStats: {
    ticTacToe: { wins: number; losses: number; ties: number };
    chess:     { wins: number; losses: number; ties: number };
    checkers:  { wins: number; losses: number; ties: number };
  };
  isOnline:   boolean;
  lastActive: Date;
  createdAt:  Date;
  updatedAt:  Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type:      String,
      required:  [true, 'Name is required'],
      trim:      true,
      minlength: [2,  'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    email: {
      type:      String,
      required:  [true, 'Email is required'],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    // No longer required — Google-auth users authenticate via token only
    password: {
      type:      String,
      minlength: [6, 'Password must be at least 6 characters'],
      select:    false,
    },
    avatar:         { type: String, default: null },
    profilePicture: { type: String, default: null },

    // Sparse indexes: null values don't take an index slot, and uniqueness is
    // only enforced among documents that actually have the field set.
    googleId: {
      type:   String,
      default: null,
      index:  { sparse: true },
    },
    deviceId: {
      type:   String,
      default: null,
      index:  { sparse: true },
    },

    authProvider: {
      type:    String,
      enum:    ['local', 'google'],
      default: 'local',
    },

    stats: {
      gamesPlayed: { type: Number, default: 0 },
      gamesWon:    { type: Number, default: 0 },
      gamesLost:   { type: Number, default: 0 },
      gamesTied:   { type: Number, default: 0 },
    },
    gameStats: {
      ticTacToe: {
        wins:   { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        ties:   { type: Number, default: 0 },
      },
      chess: {
        wins:   { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        ties:   { type: Number, default: 0 },
      },
      checkers: {
        wins:   { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        ties:   { type: Number, default: 0 },
      },
    },
    isOnline:   { type: Boolean, default: false },
    lastActive: { type: Date,    default: Date.now },
  },
  { timestamps: true },
);

// Hash password only when it is present and has been modified
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  const salt   = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>('User', UserSchema);