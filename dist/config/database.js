"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================
// FILE: src/config/database.ts
// ============================================
const mongoose_1 = __importDefault(require("mongoose"));
const connectDB = async () => {
    try {
        const conn = await mongoose_1.default.connect(process.env.MONGODB_URI || '');
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        mongoose_1.default.connection.on('error', (err) => {
            console.error(`❌ MongoDB connection error: ${err}`);
        });
        mongoose_1.default.connection.on('disconnected', () => {
            console.log('⚠️  MongoDB disconnected');
        });
    }
    catch (error) {
        console.error(`❌ Error connecting to MongoDB: ${error}`);
        process.exit(1);
    }
};
exports.default = connectDB;
//# sourceMappingURL=database.js.map