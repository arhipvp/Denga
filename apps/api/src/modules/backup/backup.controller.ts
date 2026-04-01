import {
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BackupService } from './backup.service';

type AuthenticatedRequest = {
  user: { sub: string; email: string; role: string };
};

@UseGuards(JwtAuthGuard)
@Controller('backups')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest) {
    return this.backupService.createBackup(request.user);
  }

  @Get('latest')
  getLatest(@Req() request: AuthenticatedRequest) {
    return this.backupService.getLatestBackup(request.user);
  }

  @Get('latest/download')
  @Header('Content-Type', 'application/octet-stream')
  async downloadLatest(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { fileName, stream } = await this.backupService.openLatestBackup(request.user);
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }
}
