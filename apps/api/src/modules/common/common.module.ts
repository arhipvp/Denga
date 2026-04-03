import { Global, Module } from '@nestjs/common';
import { AdminGuard } from './guards/admin.guard';
import { HouseholdContextService } from './household-context.service';
import { RuntimeValidationService } from './runtime-validation.service';

@Global()
@Module({
  providers: [HouseholdContextService, RuntimeValidationService, AdminGuard],
  exports: [HouseholdContextService, RuntimeValidationService, AdminGuard],
})
export class CommonModule {}
