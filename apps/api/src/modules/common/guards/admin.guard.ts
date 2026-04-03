import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (request.user?.role === 'ADMIN') {
      return true;
    }

    throw new ForbiddenException('Admin access required');
  }
}
