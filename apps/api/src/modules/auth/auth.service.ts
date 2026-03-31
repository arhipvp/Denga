import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { LoggingService } from '../logging/logging.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly loggingService: LoggingService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      this.loggingService.warn('auth', 'login_failed', 'Login failed', {
        email: dto.email,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    this.loggingService.info('auth', 'login_succeeded', 'Login succeeded', {
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: payload,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(dto.currentPassword, user.passwordHash))
    ) {
      this.loggingService.warn('auth', 'change_password_failed', 'Password change failed', {
        userId,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
      },
    });

    this.loggingService.info('auth', 'change_password_succeeded', 'Password changed', {
      userId: user.id,
      email: user.email,
    });

    return { success: true };
  }
}
