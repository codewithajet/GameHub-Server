interface JwtPayload {
    id: string;
}
export declare const generateToken: (userId: string) => string;
export declare const verifyToken: (token: string) => JwtPayload;
export {};
//# sourceMappingURL=jwt.utils.d.ts.map