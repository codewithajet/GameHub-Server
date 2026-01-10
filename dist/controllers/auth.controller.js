"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logout = exports.getMe = exports.login = exports.register = void 0;
const User_1 = __importDefault(require("../models/User"));
const jwt_utils_1 = require("../utils/jwt.utils");
const register = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        // Check if user exists
        const existingUser = await User_1.default.findOne({ email });
        if (existingUser) {
            res.status(400).json({
                success: false,
                message: 'User already exists with this email',
            });
            return;
        }
        // Create user
        const user = await User_1.default.create({
            name,
            email,
            password,
        });
        // Generate token
        const token = (0, jwt_utils_1.generateToken)(user._id.toString());
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    stats: user.stats,
                    gameStats: user.gameStats,
                },
                token,
            },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error registering user',
            error: error.message,
        });
    }
};
exports.register = register;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        // Validate input
        if (!email || !password) {
            res.status(400).json({
                success: false,
                message: 'Please provide email and password',
            });
            return;
        }
        // Find user with password
        const user = await User_1.default.findOne({ email }).select('+password');
        if (!user) {
            res.status(401).json({
                success: false,
                message: 'Invalid credentials',
            });
            return;
        }
        // Check password
        const isPasswordMatch = await user.comparePassword(password);
        if (!isPasswordMatch) {
            res.status(401).json({
                success: false,
                message: 'Invalid credentials',
            });
            return;
        }
        // Update online status
        user.isOnline = true;
        user.lastActive = new Date();
        await user.save();
        // Generate token
        const token = (0, jwt_utils_1.generateToken)(user._id.toString());
        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    stats: user.stats,
                    gameStats: user.gameStats,
                    isOnline: user.isOnline,
                },
                token,
            },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error logging in',
            error: error.message,
        });
    }
};
exports.login = login;
const getMe = async (req, res) => {
    try {
        const user = await User_1.default.findById(req.userId);
        if (!user) {
            res.status(404).json({
                success: false,
                message: 'User not found',
            });
            return;
        }
        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    stats: user.stats,
                    gameStats: user.gameStats,
                    isOnline: user.isOnline,
                    lastActive: user.lastActive,
                },
            },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching user data',
            error: error.message,
        });
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
        res.status(200).json({
            success: true,
            message: 'Logout successful',
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error logging out',
            error: error.message,
        });
    }
};
exports.logout = logout;
//# sourceMappingURL=auth.controller.js.map