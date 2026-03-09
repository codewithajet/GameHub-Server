"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================
// FILE: src/routes/game.routes.ts
// ============================================
const express_1 = __importDefault(require("express"));
const game_controller_1 = require("../controllers/game.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = express_1.default.Router();
router.get('/history', auth_middleware_1.protect, game_controller_1.getGameHistory);
router.get('/leaderboard', game_controller_1.getLeaderboard);
exports.default = router;
//# sourceMappingURL=game.routes.js.map