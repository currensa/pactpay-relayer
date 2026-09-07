import { IsIn, IsInt, IsString, Matches, Min } from "class-validator";

export class CreateQuoteDto {
  @IsInt()
  @Min(1)
  chainId!: number;

  @IsString()
  token!: string;

  @IsString()
  @Matches(/^[1-9]\d*$/)
  amount!: string;

  @IsInt()
  @IsIn([8, 16, 32, 64, 128])
  tier!: number;
}

export class CreateWithdrawQuoteDto extends CreateQuoteDto {}
export class CreateRefundQuoteDto extends CreateQuoteDto {}
export class CreateDefiQuoteDto extends CreateQuoteDto {}
