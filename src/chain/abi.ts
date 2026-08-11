export const WITHDRAW_TUPLE = "tuple(uint256[2] pA,uint256[2][2] pB,uint256[2] pC,bytes32 nullifierHash,address recipient,uint256 claimedAmount,address token,uint8 tier,uint256 depositRoot,uint256 expectedAmount,uint256 fee,address relayer,uint256 nonce)";

export const GRAVARC_WITHDRAW_ABI = [
  `function withdraw(${WITHDRAW_TUPLE} p)`,
] as const;
