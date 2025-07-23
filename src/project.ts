export const swapProgramIds = [
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
];

export const RaydiumCP = (item:any): any => {
  if(item.discriminator == 2495396153584390839n) return;  //Remove liquidity
  if(item.discriminator == 17121445590508351407n) return; //Add liquidity
  if(item.discriminator == 6448665121156532360n) return;  //collectProtocolFee
  if(item.discriminator == 13182846803881894898n) return; //Add liquidity
  if(item.discriminator == 9081159964177631911n) return;  //collectFundFee
  const [open,close] = item.spltokens;
  if(open==undefined || close==undefined) {
    return;
  }
  return {open,close};
}

export const Raydium = (item:any): any => {
  if(item.discriminator != 9n && item.discriminator != 11n) return;
  const [open,close] = item.spltokens;
  if(open==undefined || close==undefined) {
      return;
  }
  return {open,close};
}

export const PumpAmm = (item:any): any => {
  if(item.discriminator != 16927863322537952870n && item.discriminator != 12502976635542562355n) return;
  if(item.discriminator == 16927863322537952870n){ // 买
      var [close,open] = item.spltokens;
  }
  if(item.discriminator == 12502976635542562355n){ // 卖
      var [open,close] = item.spltokens;
  }
  if(open==undefined || close==undefined) {
      return;
  }
  return {open,close};
}

export const RaydiumCLMM = (item:any): any => {
  if(item.discriminator == BigInt('3371258220158844749')) return;
  if(item.discriminator == BigInt('6972788623384805178')) return;
  if(item.discriminator == BigInt('6448665121156532360')) return;
  if(item.discriminator == BigInt('14407391725566474317')) return;
  if(item.discriminator == BigInt('9081159964177631911')) return;
  const [open,close] = item.spltokens;
  if(open == undefined || close == undefined){
      return;
  }
  return {open,close};
}