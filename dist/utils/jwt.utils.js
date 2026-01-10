"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = exports.generateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || '04cd45b77cb91a15711014f7835bcd939ae4784149e2ed59082036499a45e77af36f30d74779676598c7bba7b61ffcdd3d3d9956c1ba167b9fe63e142cf64258';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';
// Generate JWT token
const generateToken = (userId) => {
    const payload = { id: userId };
    // Don't use SignOptions, just pass the object directly
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRE,
    });
};
exports.generateToken = generateToken;
// Verify JWT token
const verifyToken = (token) => {
    const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
    if (typeof decoded === 'object' && decoded !== null && 'id' in decoded) {
        return { id: decoded.id };
    }
    throw new Error('Invalid token');
};
exports.verifyToken = verifyToken;
//# sourceMappingURL=jwt.utils.js.map