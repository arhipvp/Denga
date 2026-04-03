import { Injectable } from '@nestjs/common';
import { BOOTSTRAP_HOUSEHOLD_ID } from './household.constants';

@Injectable()
export class HouseholdContextService {
  getHouseholdId() {
    return BOOTSTRAP_HOUSEHOLD_ID;
  }
}
