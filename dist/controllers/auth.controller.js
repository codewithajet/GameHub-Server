"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfile = exports.logout = exports.getMe = exports.login = exports.register = exports.deviceLogin = exports.googleAuth = void 0;
const User_1 = __importDefault(require("../models/User"));
const jwt_utils_1 = require("../utils/jwt.utils");
// ─── Shared helper ────────────────────────────────────────────────────────────
// Every endpoint returns the same shape so the frontend never has to branch.
const buildUserPayload = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar ?? null,
    profilePicture: user.profilePicture ?? null,
    authProvider: user.authProvider,
    stats: user.stats,
    gameStats: user.gameStats,
    isOnline: user.isOnline,
    lastActive: user.lastActive,
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
const googleAuth = async (req, res) => {
    try {
        const { accessToken, googleId: clientGoogleId, // sent by the app; we re-verify below
        name: bodyName, email: bodyEmail, profilePicture: bodyPicture, deviceId, } = req.body;
        if (!accessToken) {
            res.status(400).json({ success: false, message: 'Google access token is required' });
            return;
        }
        // ── Step 1: Verify the access token with Google ─────────────────────────
        // tokeninfo returns the claims associated with the token.
        // It throws (non-2xx) if the token is expired or tampered.
        let googleProfile;
        try {
            const tokenRes = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
            if (!tokenRes.ok) {
                const errBody = await tokenRes.text();
                console.error('Google userinfo error:', tokenRes.status, errBody);
                res.status(401).json({ success: false, message: 'Invalid or expired Google token' });
                return;
            }
            googleProfile = await tokenRes.json();
            // shape: { id, email, name, picture, given_name, family_name, ... }
        }
        catch (fetchError) {
            console.error('❌ Google verification fetch failed:', fetchError.message);
            res.status(401).json({ success: false, message: 'Could not verify Google token' });
            return;
        }
        // Use verified data from Google; only fall back to body values if Google
        // did not return the field (very rare with the userinfo endpoint).
        const googleId = googleProfile.id || clientGoogleId || '';
        const verifiedEmail = (googleProfile.email || bodyEmail || '').toLowerCase().trim();
        const verifiedName = googleProfile.name || bodyName || 'GameHub Player';
        const verifiedPic = googleProfile.picture || bodyPicture || null;
        if (!googleId || !verifiedEmail) {
            res.status(400).json({ success: false, message: 'Could not extract identity from Google token' });
            return;
        }
        // ── Step 2: Find or create user ─────────────────────────────────────────
        // Search by googleId first (fast indexed lookup).
        // Fall back to email so pre-existing local accounts are merged rather than
        // duplicated when a user signs in with Google for the first time.
        let user = await User_1.default.findOne({ googleId });
        if (!user)
            user = await User_1.default.findOne({ email: verifiedEmail });
        if (user) {
            // ── Existing user: update mutable fields ───────────────────────────
            let dirty = false;
            if (!user.googleId) {
                user.googleId = googleId;
                user.authProvider = 'google';
                dirty = true;
            }
            // Refresh profile picture — Google CDN URLs rotate periodically
            if (verifiedPic && user.profilePicture !== verifiedPic) {
                user.profilePicture = verifiedPic;
                dirty = true;
            }
            // Register device for auto-login only if a deviceId was provided
            if (deviceId && user.deviceId !== deviceId) {
                user.deviceId = deviceId;
                dirty = true;
            }
            user.isOnline = true;
            user.lastActive = new Date();
            if (dirty) {
                await user.save();
            }
            else {
                // Still bump lastActive even when nothing else changed
                await User_1.default.updateOne({ _id: user._id }, { isOnline: true, lastActive: new Date() });
            }
        }
        else {
            // ── New user: create ────────────────────────────────────────────────
            user = await User_1.default.create({
                name: verifiedName,
                email: verifiedEmail,
                googleId,
                profilePicture: verifiedPic,
                deviceId: deviceId || null,
                authProvider: 'google',
                isOnline: true,
                lastActive: new Date(),
                // No password — this user authenticates via Google only
            });
        }
        const token = (0, jwt_utils_1.generateToken)(user._id.toString());
        res.status(200).json({
            success: true,
            message: 'Google authentication successful',
            data: { user: buildUserPayload(user), token },
        });
    }
    catch (error) {
        console.error('❌ googleAuth error:', error);
        res.status(500).json({
            success: false,
            message: 'Google authentication failed',
            error: error.message,
        });
    }
};
exports.googleAuth = googleAuth;
// =============================================================================
// POST /api/auth/device-login
//
// Body: { deviceId }
//
// Silent auto-login called on every app boot before showing the auth screen.
// Returns HTTP 404 (intentionally, not a server error) when the device is
// unknown — the app then shows the normal sign-in screen.
// =============================================================================
const deviceLogin = async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) {
            res.status(400).json({ success: false, message: 'deviceId is required' });
            return;
        }
        const user = await User_1.default.findOne({ deviceId });
        if (!user) {
            // 404 is intentional — "not registered yet" is not a server error
            res.status(404).json({ success: false, message: 'No account linked to this device' });
            return;
        }
        user.isOnline = true;
        user.lastActive = new Date();
        await user.save();
        const token = (0, jwt_utils_1.generateToken)(user._id.toString());
        res.status(200).json({
            success: true,
            message: 'Auto-login successful',
            data: { user: buildUserPayload(user), token },
        });
    }
    catch (error) {
        console.error('❌ deviceLogin error:', error);
        res.status(500).json({
            success: false,
            message: 'Device login failed',
            error: error.message,
        });
    }
};
exports.deviceLogin = deviceLogin;
// =============================================================================
// Original endpoints — preserved exactly.
// Only the response shape is unified via buildUserPayload so the frontend
// always receives the same fields regardless of sign-in method.
// =============================================================================
const register = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User_1.default.findOne({ email });
        if (existingUser) {
            res.status(400).json({ success: false, message: 'User already exists with this email' });
            return;
        }
        const user = await User_1.default.create({ name, email, password });
        const token = (0, jwt_utils_1.generateToken)(user._id.toString());
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: { user: buildUserPayload(user), token },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Error registering user', error: error.message });
    }
};
exports.register = register;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ success: false, message: 'Please provide email and password' });
            return;
        }
        const user = await User_1.default.findOne({ email }).select('+password');
        if (!user || !(await user.comparePassword(password))) {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
            return;
        }
        user.isOnline = true;
        user.lastActive = new Date();
        await user.save();
        const token = (0, jwt_utils_1.generateToken)(user._id.toString());
        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: { user: buildUserPayload(user), token },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Error logging in', error: error.message });
    }
};
exports.login = login;
const getMe = async (req, res) => {
    try {
        const user = await User_1.default.findById(req.userId);
        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }
        res.status(200).json({
            success: true,
            data: { user: buildUserPayload(user) },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching user data', error: error.message });
    }
};
exports.getMe = getMe;
const logout = async (req, res) => {
    try {
        const user = await User_1.default.findById(req.userId);
        if (user) {
            user.isOnline = false;
            user.lastActive = new Date();
            await user.save();
        }
        res.status(200).json({ success: true, message: 'Logout successful' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Error logging out', error: error.message });
    }
};
exports.logout = logout;
const updateProfile = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Not authenticated' });
        }
        const { name, currentPassword, newPassword } = req.body;
        // ── Validation ────────────────────────────────────────────────────────────
        if (name !== undefined) {
            const trimmed = name.trim();
            if (trimmed.length < 2 || trimmed.length > 50) {
                return res.status(400).json({
                    success: false,
                    message: 'Name must be between 2 and 50 characters.',
                });
            }
        }
        if (newPassword !== undefined) {
            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'New password must be at least 6 characters.',
                });
            }
            if (!currentPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Please provide your current password to set a new one.',
                });
            }
        }
        // ── Load user (with password for verification) ────────────────────────────
        const user = await User_1.default.findById(userId).select('+password');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        // ── Password change flow ──────────────────────────────────────────────────
        if (newPassword) {
            // Google-only accounts have no password — block change
            if (!user.password) {
                return res.status(400).json({
                    success: false,
                    message: 'Your account uses Google Sign-In. Password changes are not supported.',
                });
            }
            const isMatch = await user.comparePassword(currentPassword);
            if (!isMatch) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is incorrect.',
                });
            }
            user.password = newPassword; // pre-save hook in User model handles hashing
        }
        // ── Apply name change ─────────────────────────────────────────────────────
        if (name !== undefined) {
            user.name = name.trim();
        }
        await user.save();
        // ── Return updated user (without password) ────────────────────────────────
        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully.',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    avatar: user.avatar,
                    authProvider: user.authProvider ?? 'local',
                    profilePicture: user.profilePicture ?? null,
                    stats: user.stats,
                    gameStats: user.gameStats,
                },
            },
        });
    }
    catch (error) {
        console.error('updateProfile error:', error);
        return res.status(500).json({
            success: false,
            message: error.message ?? 'Server error. Please try again.',
        });
    }
};
exports.updateProfile = updateProfile;
//# sourceMappingURL=auth.controller.js.map