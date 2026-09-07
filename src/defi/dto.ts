import { IsInt, IsString, Matches, Min } from "class-validator";

export class SubmitDefiDto {
  @IsInt() @Min(1) chainId!: number;
  @IsString() @Matches(/^[0-9a-fA-F-]{36}$/) quoteId!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]+$/) calldata!: string;
}
