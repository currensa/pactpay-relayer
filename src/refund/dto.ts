import { IsInt, IsString, IsUUID, Matches, Min } from "class-validator";

export class SubmitRefundDto {
  @IsInt()
  @Min(1)
  chainId!: number;

  @IsUUID()
  quoteId!: string;

  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/)
  calldata!: string;
}
