export const WITHDRAW_TUPLE = "tuple(uint256[2] pA,uint256[2][2] pB,uint256[2] pC,bytes32 nullifierHash,address recipient,uint256 claimedAmount,address token,uint8 tier,uint256 depositRoot,uint256 expectedAmount,uint256 fee,address relayer,uint256 nonce)";

export const GRAVARC_WITHDRAW_ABI = [
  `function withdraw(${WITHDRAW_TUPLE} p)`,
] as const;

export const REFUND_TUPLE = "tuple(uint256[2] pA,uint256[2][2] pB,uint256[2] pC,uint256 depositRoot,bytes32[] nullifierHash,address token,uint256 refundAmount,uint256 fee,address relayer,address refunder,uint8 tier)";

export const GRAVARC_REFUND_ABI = [
  `function refund(${REFUND_TUPLE} p)`,
] as const;
