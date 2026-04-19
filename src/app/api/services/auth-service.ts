/**
 * API Service Layer - Authentication
 *
 * This service provides a boundary between API routes and server logic.
 * It handles authentication operations without exposing server internals.
 */

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  isActive: boolean;
  sellerId?: string;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

export interface AuthService {
  authenticateUser(email: string, password: string): Promise<AuthResult>;
  generateToken(user: AuthUser): string;
  verifyPassword(password: string, hash: string): Promise<boolean>;
}

/**
 * Implementation of AuthService using server dependencies
 * This is the only place that can import from server layer
 */
class AuthServiceImpl implements AuthService {
  private prisma: typeof import('@/server/db/prisma').prisma;
  private authLib: {
    generateToken: (user: AuthUser) => string;
    verifyPassword: (password: string, hash: string) => Promise<boolean>;
  };
  private rateLimitConfig: typeof import('@/server/lib/rate-limit').RATE_LIMIT_CONFIGS;

  constructor() {
    // These imports are isolated to the service layer
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const prismaModule = require('@/server/db/prisma');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const authModule = require('@/server/lib/auth');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rateLimitModule = require('@/server/lib/rate-limit');

    this.prisma = prismaModule.prisma;
    this.authLib = {
      generateToken: authModule.generateToken,
      verifyPassword: authModule.verifyPassword,
    };
    this.rateLimitConfig = rateLimitModule.RATE_LIMIT_CONFIGS;
  }

  async authenticateUser(email: string, password: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        ownedSeller: {
          select: { id: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new Error('Invalid credentials');
    }

    const isValidPassword = await this.authLib.verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      sellerId: user.ownedSeller?.id,
    };

    const token = this.authLib.generateToken(authUser);

    return { user: authUser, token };
  }

  generateToken(user: AuthUser): string {
    return this.authLib.generateToken(user);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return this.authLib.verifyPassword(password, hash);
  }
}

// Export singleton instance
export const authService = new AuthServiceImpl();
