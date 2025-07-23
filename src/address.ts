import Redis from 'ioredis';
import { PublicKey } from '@solana/web3.js';
// 获取钱包地址列表
export async function getWalletAddresses(redisClient:Redis): Promise<string[]> {
  try {
    const addresses = await redisClient.smembers('wallet_addresses');
    return addresses;
  } catch (error) {
    console.error('获取钱包地址列表时出错:', error);
    throw error;
  }
}

// 删除单个钱包地址
export async function removeWalletAddress(redisClient:Redis,address: string): Promise<boolean> {
  try {
    // 验证地址格式
    new PublicKey(address);
    
    // 检查地址是否存在
    const exists = await redisClient.sismember('wallet_addresses', address);
    if (!exists) {
      return false; // 地址不存在
    }
    
    // 从Redis Set中删除地址
    await redisClient.srem('wallet_addresses', address);
    console.log(`钱包地址 ${address} 已从列表中删除`);
    return true;
  } catch (error) {
    console.error('删除钱包地址时出错:', error);
    throw error;
  }
}

// 批量添加钱包地址
export async function addWalletAddressesBatch(redisClient:Redis,addresses: string[]): Promise<{success: string[], failed: string[], duplicates: string[]}> {
  const result = {
    success: [] as string[],
    failed: [] as string[],
    duplicates: [] as string[]
  };
  
  for (const address of addresses) {
    try {
      // 验证地址格式
      new PublicKey(address);
      
      // 检查地址是否已存在
      const exists = await redisClient.sismember('wallet_addresses', address);
      if (exists) {
        result.duplicates.push(address);
        continue;
      }
      
      // 添加地址到Redis Set
      await redisClient.sadd('wallet_addresses', address);
      result.success.push(address);
      console.log(`钱包地址 ${address} 已添加到列表`);
    } catch (error) {
      console.error(`添加钱包地址 ${address} 时出错:`, error);
      result.failed.push(address);
    }
  }
  
  return result;
}

// 添加钱包地址到Redis列表
export async function addWalletAddress(redisClient:Redis,address: string): Promise<boolean> {
  try {
    // 验证地址格式
    new PublicKey(address);
    
    // 检查地址是否已存在
    const exists = await redisClient.sismember('wallet_addresses', address);
    if (exists) {
      return false; // 地址已存在
    }
    
    // 添加地址到Redis Set
    await redisClient.sadd('wallet_addresses', address);
    console.log(`钱包地址 ${address} 已添加到列表`);
    return true;
  } catch (error) {
    console.error('添加钱包地址时出错:', error);
    throw error;
  }
}
