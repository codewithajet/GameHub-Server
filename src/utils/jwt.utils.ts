import jwt from 'jsonwebtoken';

const JWT_SECRET: string = process.env.JWT_SECRET || '04cd45b77cb91a15711014f7835bcd939ae4784149e2ed59082036499a45e77af36f30d74779676598c7bba7b61ffcdd3d3d9956c1ba167b9fe63e142cf64258';
const JWT_EXPIRE: string = process.env.JWT_EXPIRE || '7d';

interface JwtPayload {
  id: string;
}

export const generateToken = (userId: string): string => {
  const payload: JwtPayload = { id: userId };
  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: JWT_EXPIRE 
  });
};

export const verifyToken = (token: string): JwtPayload => {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (error) {
    throw new Error('Invalid token');
  }
};