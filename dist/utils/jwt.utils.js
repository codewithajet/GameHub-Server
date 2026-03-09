import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || '04cd45b77cb91a15711014f7835bcd939ae4784149e2ed59082036499a45e77af36f30d74779676598c7bba7b61ffcdd3d3d9956c1ba167b9fe63e142cf64258';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';
// Generate JWT token
export const generateToken = (userId) => {
    const payload = { id: userId };
    const options = {
        expiresIn: JWT_EXPIRE,
    };
    return jwt.sign(payload, JWT_SECRET, options);
};
// Verify JWT token
export const verifyToken = (token) => {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === 'object' && decoded !== null && 'id' in decoded) {
        return { id: decoded.id };
    }
    throw new Error('Invalid token');
};
//# sourceMappingURL=jwt.utils.js.map