// src/models/User.ts
import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  name:           string;
  email:          string;
  password?:      string;            // optional — Google users have no password
  avatar?:        string;
  profilePicture?: string | null;    // Google profile photo URL
  googleId?:      string;            // Google OAuth sub (unique ID)
  deviceId?:      string;            // device fingerprint for silent auto-login
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

    // FIX: password is now optional so Google users can be saved without one
    password: {
      type:      String,
      minlength: [6, 'Password must be at least 6 characters'],
      select:    false,   // never returned in queries unless explicitly requested
    },

    avatar: { type: String, default: null },

    // Google-specific fields
    profilePicture: { type: String, default: null },
    googleId:       { type: String, default: null, sparse: true },
    deviceId:       { type: String, default: null },
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
      ticTacToe: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, ties: { type: Number, default: 0 } },
      chess:     { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, ties: { type: Number, default: 0 } },
      checkers:  { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 }, ties: { type: Number, default: 0 } },
    },
    isOnline:   { type: Boolean, default: false },
    lastActive: { type: Date,    default: Date.now },
  },
  { timestamps: true },
);

// Hash password before saving — only when it was modified and actually exists
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  const salt    = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// comparePassword — safe for Google users (returns false if no password stored)
UserSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>('User', UserSchema);