import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LoggingService } from '../logging/logging.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly loggingService: LoggingService,
  ) {}

  @Get()
  list() {
    return this.userService.list();
  }

  @Patch(':id')
  async update(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    const user = await this.userService.updateDisplayName(id, dto);
    this.loggingService.info('admin', 'user_renamed', 'User renamed', {
      actorId: request.user.sub,
      actorEmail: request.user.email,
      userId: user.id,
      displayName: user.displayName,
    });
    return user;
  }
}
