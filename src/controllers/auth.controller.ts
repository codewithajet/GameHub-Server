// src/controllers/auth.controller.ts
// Drop-in replacement.
// Adds: googleAuth, deviceLogin
// Keeps: register, login, getMe, logout — all preserved exactly.
import { Request, Response } from 'express';
import User from '../models/User';
import { generateToken } from '../utils/jwt.utils';
import { AuthRequest } from '../types';

// ─── Shared helper ────────────────────────────────────────────────────────────
// Every endpoint returns the same shape so the frontend never has to branch.
const buildUserPayload = (user: any) => ({
  id:             user._id,
  name:           user.name,
  email:          user.email,
  avatar:         user.avatar          ?? null,
  profilePicture: user.profilePicture  ?? null,
  authProvider:   user.authProvider,
  stats:          user.stats,
  gameStats:      user.gameStats,
  isOnline:       user.isOnline,
  lastActive:     user.lastActive,
});

// =============================================================================
// POST /api/auth/google
//
// Body: { accessToken, googleId, name, email, profilePicture, deviceId }
//
// Why accessToken instead of idToken?
//   expo-auth-session's Google provider uses the OAuth2 implicit / PKCE flow
//   which returns an access token.  We verify it by calling Google's
//   tokeninfo endpoint (no extra library needed, works with any token type).
//
// Flow:
//  1. Verify access token with Google tokeninfo — rejects tampered tokens
//  2. Extract the canonical googleId, email, name, picture from Google
//  3. Look up existing user by googleId, fall back to email (handles accounts
//     that existed before Google auth was added)
//  4. Create if new, update profilePicture/deviceId if existing
//  5. Return GameHub JWT + user object
// =============================================================================
export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      accessToken,
      googleId:       clientGoogleId,   // sent by the app; we re-verify below
      name:           bodyName,
      email:          bodyEmail,
      profilePicture: bodyPicture,
      deviceId,
    } = req.body;

    if (!accessToken) {
      res.status(400).json({ success: false, message: 'Google access token is required' });
      return;
    }

    // ── Step 1: Verify the access token with Google ─────────────────────────
    // tokeninfo returns the claims associated with the token.
    // It throws (non-2xx) if the token is expired or tampered.
    let googleProfile: any;
    try {
      const tokenRes = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        console.error('Google userinfo error:', tokenRes.status, errBody);
        res.status(401).json({ success: false, message: 'Invalid or expired Google token' });
        return;
      }

      googleProfile = await tokenRes.json();
      // shape: { id, email, name, picture, given_name, family_name, ... }
    } catch (fetchError: any) {
      console.error('❌ Google verification fetch failed:', fetchError.message);
      res.status(401).json({ success: false, message: 'Could not verify Google token' });
      return;
    }

    // Use verified data from Google; only fall back to body values if Google
    // did not return the field (very rare with the userinfo endpoint).
    const googleId       = googleProfile.id    || clientGoogleId || '';
    const verifiedEmail  = (googleProfile.email   || bodyEmail   || '').toLowerCase().trim();
    const verifiedName   = googleProfile.name   || bodyName   || 'GameHub Player';
    const verifiedPic    = googleProfile.picture || bodyPicture || null;

    if (!googleId || !verifiedEmail) {
      res.status(400).json({ success: false, message: 'Could not extract identity from Google token' });
      return;
    }

    // ── Step 2: Find or create user ─────────────────────────────────────────
    // Search by googleId first (fast indexed lookup).
    // Fall back to email so pre-existing local accounts are merged rather than
    // duplicated when a user signs in with Google for the first time.
    let user = await User.findOne({ googleId });
    if (!user) user = await User.findOne({ email: verifiedEmail });

    if (user) {
      // ── Existing user: update mutable fields ───────────────────────────
      let dirty = false;

      if (!user.googleId) {
        (user as any).googleId      = googleId;
        (user as any).authProvider  = 'google';
        dirty = true;
      }

      // Refresh profile picture — Google CDN URLs rotate periodically
      if (verifiedPic && user.profilePicture !== verifiedPic) {
        (user as any).profilePicture = verifiedPic;
        dirty = true;
      }

      // Register device for auto-login only if a deviceId was provided
      if (deviceId && user.deviceId !== deviceId) {
        (user as any).deviceId = deviceId;
        dirty = true;
      }

      (user as any).isOnline   = true;
      (user as any).lastActive = new Date();

      if (dirty) {
        await user.save();
      } else {
        // Still bump lastActive even when nothing else changed
        await User.updateOne({ _id: user._id }, { isOnline: true, lastActive: new Date() });
      }
    } else {
      // ── New user: create ────────────────────────────────────────────────
      user = await User.create({
        name:           verifiedName,
        email:          verifiedEmail,
        googleId,
        profilePicture: verifiedPic,
        deviceId:       deviceId || null,
        authProvider:   'google',
        isOnline:       true,
        lastActive:     new Date(),
        // No password — this user authenticates via Google only
      });
    }

    const token = generateToken(user._id.toString());

    res.status(200).json({
      success: true,
      message: 'Google authentication successful',
      data: { user: buildUserPayload(user), token },
    });
  } catch (error: any) {
    console.error('❌ googleAuth error:', error);
    res.status(500).json({
      success:  false,
      message:  'Google authentication failed',
      error:    error.message,
    });
  }
};

// =============================================================================
// POST /api/auth/device-login
//
// Body: { deviceId }
//
// Silent auto-login called on every app boot before showing the auth screen.
// Returns HTTP 404 (intentionally, not a server error) when the device is
// unknown — the app then shows the normal sign-in screen.
// =============================================================================
export const deviceLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      res.status(400).json({ success: false, message: 'deviceId is required' });
      return;
    }

    const user = await User.findOne({ deviceId });

    if (!user) {
      // 404 is intentional — "not registered yet" is not a server error
      res.status(404).json({ success: false, message: 'No account linked to this device' });
      return;
    }

    (user as any).isOnline   = true;
    (user as any).lastActive = new Date();
    await user.save();

    const token = generateToken(user._id.toString());

    res.status(200).json({
      success: true,
      message: 'Auto-login successful',
      data: { user: buildUserPayload(user), token },
    });
  } catch (error: any) {
    console.error('❌ deviceLogin error:', error);
    res.status(500).json({
      success: false,
      message: 'Device login failed',
      error:   error.message,
    });
  }
};

// =============================================================================
// Original endpoints — preserved exactly.
// Only the response shape is unified via buildUserPayload so the frontend
// always receives the same fields regardless of sign-in method.
// =============================================================================

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({ success: false, message: 'User already exists with this email' });
      return;
    }

    const user  = await User.create({ name, email, password });
    const token = generateToken(user._id.toString());

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: { user: buildUserPayload(user), token },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error registering user', error: error.message });
  }
};

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

    (user as any).isOnline   = true;
    (user as any).lastActive = new Date();
    await user.save();

    const token = generateToken(user._id.toString());

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: { user: buildUserPayload(user), token },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error logging in', error: error.message });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    res.status(200).json({
      success: true,
      data: { user: buildUserPayload(user) },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error fetching user data', error: error.message });
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId);
    if (user) {
      (user as any).isOnline   = false;
      (user as any).lastActive = new Date();
      await user.save();
    }
    res.status(200).json({ success: true, message: 'Logout successful' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error logging out', error: error.message });
  }
};