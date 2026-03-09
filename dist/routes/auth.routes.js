"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/auth.routes.ts
const express_1 = __importDefault(require("express"));
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
// ── Public (no JWT required) ──────────────────────────────────────────────────
router.post('/register', auth_controller_1.register);
router.post('/login', auth_controller_1.login);
router.post('/google', auth_controller_1.googleAuth); // Google OAuth sign-in / sign-up
router.post('/device-login', auth_controller_1.deviceLogin); // Silent auto-login via device ID
// ── Protected (JWT required) ──────────────────────────────────────────────────
router.get('/me', auth_middleware_1.protect, auth_controller_1.getMe);
router.post('/logout', auth_middleware_1.protect, auth_controller_1.logout);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map