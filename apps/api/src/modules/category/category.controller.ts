import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LoggingService } from '../logging/logging.service';
import { CategoryService } from './category.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoryController {
  constructor(
    private readonly categoryService: CategoryService,
    private readonly loggingService: LoggingService,
  ) {}

  @Get()
  list() {
    return this.categoryService.list();
  }

  @Post()
  async create(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Body() dto: CreateCategoryDto,
  ) {
    const category = await this.categoryService.create(dto);
    this.loggingService.info('admin', 'category_created', 'Category created', {
      actorId: request.user.sub,
      actorEmail: request.user.email,
      categoryId: category.id,
      type: category.type,
    });
    return category;
  }

  @Patch(':id')
  async update(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    const category = await this.categoryService.update(id, dto);
    this.loggingService.info('admin', 'category_updated', 'Category updated', {
      actorId: request.user.sub,
      actorEmail: request.user.email,
      categoryId: id,
    });
    return category;
  }

  @Delete(':id')
  async remove(
    @Req() request: { user: { sub: string; email: string; role: string } },
    @Param('id') id: string,
  ) {
    const result = await this.categoryService.remove(id);
    this.loggingService.info('admin', 'category_removed', 'Category disabled', {
      actorId: request.user.sub,
      actorEmail: request.user.email,
      categoryId: id,
    });
    return result;
  }
}
