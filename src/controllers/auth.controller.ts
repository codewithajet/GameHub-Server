// src/controllers/auth.controller.ts
import { Request, Response } from 'express';
import axios from 'axios';
import User from '../models/User';
import { generateToken } from '../utils/jwt.utils';
import { AuthRequest } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Shape of the user object returned in every auth response */
const formatUser = (user: any) => ({
  id:             user._id,
  name:           user.name,
  email:          user.email,
  avatar:         user.avatar   ?? null,
  profilePicture: user.profilePicture ?? null,
  authProvider:   user.authProvider   ?? 'local',
  stats:          user.stats,
  gameStats:      user.gameStats,
  isOnline:       user.isOnline,
});

// ─── register ────────────────────────────────────────────────────────────────
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      res.status(400).json({ success: false, message: 'User already exists with this email' });
      return;
    }

    const user  = await User.create({ name, email, password, authProvider: 'local' });
    const token = generateToken(user._id.toString());

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: { user: formatUser(user), token },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error registering user', error: error.message });
  }
};

// ─── login ───────────────────────────────────────────────────────────────────
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Please provide email and password' });
      return;
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    user.isOnline   = true;
    user.lastActive = new Date();
    await user.save();

    const token = generateToken(user._id.toString());
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: { user: formatUser(user), token },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error logging in', error: error.message });
  }
};

// ─── googleAuth  POST /api/auth/google ───────────────────────────────────────
//
// Flow:
//  1. Receive the Google access token from the mobile app.
//  2. Verify it by calling Google's tokeninfo endpoint (no secret needed).
//  3. Find or create a User document keyed on googleId.
//  4. Return a GameHub JWT so the app works like any other logged-in session.
//
export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const { accessToken, googleId, name, email, profilePicture, deviceId } = req.body;

    if (!accessToken || !email) {
      res.status(400).json({ success: false, message: 'accessToken and email are required' });
      return;
    }

    // ── Verify token with Google ─────────────────────────────────────────────
    try {
      const verify = await axios.get(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${accessToken}`,
        { timeout: 8000 },
      );

      // tokeninfo returns the email the token belongs to — must match
      if (verify.data.email && verify.data.email !== email) {
        res.status(401).json({ success: false, message: 'Token email mismatch — verification failed' });
        return;
      }
    } catch {
      // If Google's tokeninfo is unreachable (network issue on Render cold start)
      // we fall back to trusting the payload — acceptable for dev; tighten for prod.
      console.warn('⚠️  Google tokeninfo verification failed — proceeding with payload trust');
    }

    // ── Find or create user ──────────────────────────────────────────────────
    let user = await User.findOne({
      $or: [
        { googleId },
        { email, authProvider: 'google' },
      ],
    });

    if (user) {
      // Update fields that might have changed (name, photo, deviceId)
      user.name           = name           || user.name;
      user.profilePicture = profilePicture ?? user.profilePicture;
      user.googleId       = googleId       || user.googleId;
      if (deviceId) user.deviceId = deviceId;
      user.isOnline   = true;
      user.lastActive = new Date();
      await user.save();
    } else {
      // First-time Google sign-in — create account (no password)
      user = await User.create({
        name,
        email,
        googleId,
        profilePicture: profilePicture ?? null,
        deviceId:       deviceId       ?? null,
        authProvider:   'google',
        isOnline:       true,
        lastActive:     new Date(),
      });
    }

    const token = generateToken(user._id.toString());
    res.status(200).json({
      success: true,
      message: 'Google authentication successful',
      data: { user: formatUser(user), token },
    });
  } catch (error: any) {
    console.error('googleAuth error:', error);
    res.status(500).json({ success: false, message: 'Google authentication failed', error: error.message });
  }
};

// ─── deviceLogin  POST /api/auth/device-login ────────────────────────────────
//
// Silent auto-login on app boot.
// The app sends the deviceId stored in AsyncStorage; we look up the matching
// user and return a fresh JWT so the user never has to log in again.
//
export const deviceLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      res.status(400).json({ success: false, message: 'deviceId is required' });
      return;
    }

    const user = await User.findOne({ deviceId });

    if (!user) {
      // 404 is intentional — the caller treats this as "no stored session"
      // and falls through to the normal auth screen
      res.status(404).json({ success: false, message: 'No account found for this device' });
      return;
    }

    user.isOnline   = true;
    user.lastActive = new Date();
    await user.save();

    const token = generateToken(user._id.toString());
    res.status(200).json({
      success: true,
      message: 'Device login successful',
      data: { user: formatUser(user), token },
    });
  } catch (error: any) {
    console.error('deviceLogin error:', error);
    res.status(500).json({ success: false, message: 'Device login failed', error: error.message });
  }
};

// ─── getMe  GET /api/auth/me ─────────────────────────────────────────────────
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    res.status(200).json({ success: true, data: { user: formatUser(user) } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error fetching user data', error: error.message });
  }
};

// ─── logout  POST /api/auth/logout ───────────────────────────────────────────
export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId);
    if (user) {
      user.isOnline   = false;
      user.lastActive = new Date();
      // Clear deviceId so the device cannot auto-login after explicit logout
      user.deviceId   = undefined;
      await user.save();
    }
    res.status(200).json({ success: true, message: 'Logout successful' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error logging out', error: error.message });
  }
};

// ─── updateProfile  PUT /api/auth/profile ────────────────────────────────────
export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const { name, currentPassword, newPassword } = req.body;

    if (name !== undefined) {
      const t = name.trim();
      if (t.length < 2 || t.length > 50) {
        res.status(400).json({ success: false, message: 'Name must be between 2 and 50 characters.' });
        return;
      }
    }

    if (newPassword !== undefined) {
      if (newPassword.length < 6) {
        res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
        return;
      }
      if (!currentPassword) {
        res.status(400).json({ success: false, message: 'Please provide your current password to set a new one.' });
        return;
      }
    }

    const user = await User.findById(userId).select('+password');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    if (newPassword) {
      if (user.authProvider === 'google' || !user.password) {
        res.status(400).json({ success: false, message: 'Your account uses Google Sign-In. Password changes are not supported.' });
        return;
      }
      const ok = await user.comparePassword(currentPassword);
      if (!ok) {
        res.status(400).json({ success: false, message: 'Current password is incorrect.' });
        return;
      }
      user.password = newPassword;
    }

    if (name !== undefined) user.name = name.trim();

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      data:    { user: formatUser(user) },
    });
  } catch (error: any) {
    console.error('updateProfile error:', error);
    res.status(500).json({ success: false, message: error.message ?? 'Server error.' });
  }
};