import {
  IsIn,
  IsInt,
  IsPositive,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class UpdateSettingsDto {
  @IsString()
  @MinLength(1)
  householdName!: string;

  @IsString()
  @Length(3, 3)
  defaultCurrency!: string;

  @IsIn(['polling', 'webhook'])
  telegramMode!: 'polling' | 'webhook';

  @IsInt()
  @IsPositive()
  clarificationTimeoutMinutes!: number;

  @IsString()
  @MinLength(10)
  parsingPrompt!: string;

  @IsString()
  @MinLength(3)
  aiModel!: string;

  @IsString()
  @MinLength(10)
  clarificationPrompt!: string;
}
