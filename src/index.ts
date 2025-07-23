import axios from 'axios';
import * as http from 'http';
import * as url from 'url';
import Redis from 'ioredis';
import base58 from "bs58";
import { Decimal } from 'decimal.js';
import { Connection, PublicKey } from '@solana/web3.js';

import dotenv from 'dotenv';
dotenv.config({ path: './.env' });
import { RaydiumCP,Raydium,PumpAmm,RaydiumCLMM,swapProgramIds } from './project';
import { getWalletAddresses,removeWalletAddress,addWalletAddressesBatch,addWalletAddress } from './address';

import { transferInstructionData, transferCheckedInstructionData } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import { fetchMetadata, findMetadataPda } from '@metaplex-foundation/mpl-token-metadata';
import Client from "@triton-one/yellowstone-grpc";
import { SubscribeRequest } from "@triton-one/yellowstone-grpc";
import WebSocket, { WebSocketServer } from 'ws';

interface ClientInfo {
  ws: WebSocket;
  heliusWs?: WebSocket;
  subscriptions: Set<string>;
  swapBuffer: any[];
}

interface TokenAccountInfo {
  walletAddress: string
  tokenAccount: string
  balance: number
  transactionCount?: number
  value?: number
  isOwen: boolean
  buyTotalAmount: number
  buyTotalQuantity: number
  sellTotalAmount: number
  sellTotalQuantity: number
  buyTotalNumber: number
  sellTotalNumber: number
}

// Solana 连接配置
const PRCURL = process.env.PRCURL || 'https://solana-rpc.publicnode.com';
const GRPC_URL = 'https://laserstream-mainnet-slc.helius-rpc.com';
const HeliusKey = process.env.HeliusKey;
const connection = new Connection(PRCURL, 'confirmed');
const PORT = process.env.PORT || 3010;
const PASSWORD = process.env.PASSWORD || '';
const redisClient = new Redis(6379,'127.0.0.1',{password:PASSWORD});
const WSS_PORT = Number(process.env.WSPORT) || 28080;
const ATLAS_URL = 'wss://atlas-mainnet.helius-rpc.com/?api-key='+HeliusKey;

// 连接到 Redis
redisClient.on('error', (err: Error) => {
  console.error('Redis 连接错误:', err);
});

redisClient.on('connect', () => {
  console.log('已连接到 Redis');
});

// WebSocket 服务器相关变量
let wssServer: WebSocketServer;
const clientConnections = new Map<string, ClientInfo>();

// 全局钱包地址缓存
let globalWalletAddresses: string[] = [];

let tokenAccounts: Record<string, TokenAccountInfo[]> = {};
const ownAddress = new Map<string, boolean>();

// 获取账户余额
async function getAccountBalance(publicKeyString: string): Promise<number> {
  try {
    const publicKey = new PublicKey(publicKeyString);
    const balance = await connection.getBalance(publicKey);
    return balance / 1e9; // 转换为 SOL
  } catch (error) {
    console.error('获取账户余额时出错:', error);
    throw error;
  }
}

// 获取 Solana 价格
async function getSolanaPrice(): Promise<number> {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    return response.data.solana.usd;
  } catch (error) {
    console.error('获取 Solana 价格时出错:', error);
    throw error;
  }
}

// 格式化交易中金额
function transferAmountData(data:any){
    if (data.length === 9) {
        return transferInstructionData.decode(data).amount
    } else if (data.length === 10) {
        return transferCheckedInstructionData.decode(data).amount
    } else {
        return 0;
    }
}

//获取代币元数据
async function getTokenMetadata(mintAddress: string): Promise<any> {
  try {
    const umi = createUmi(PRCURL);
    const mint = publicKey(mintAddress);
    
    // 查找元数据PDA
    const metadataPda = findMetadataPda(umi, { mint });
    
    // 获取元数据
    const metadata = await fetchMetadata(umi, metadataPda);
    
    return {
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mint: mintAddress,
      updateAuthority: metadata.updateAuthority,
      sellerFeeBasisPoints: metadata.sellerFeeBasisPoints
    };
  } catch (error) {
    console.error('获取代币元数据时出错:', error);
    return null;
  }
}

async function getInfo(address: string): Promise<any> {
  var token:any = {};
  const mint = await redisClient.get(`mint:${address}`);
  if(mint){
    token = JSON.parse(mint);
  }else{
    token = await getTokenMetadata(address);
    redisClient.set(`mint:${address}`,JSON.stringify(token));
  }
  
  return { token }
}

// 处理 HTTP 请求
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url || '', true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // 路由处理
  if (pathname === '/api/') {
    res.writeHead(200);
    res.end(JSON.stringify({
      message: 'Solana Trading API',
      version: '1.0.0',
      endpoints: {
        '/price': 'GET - 获取 SOL 价格',
        '/balance': 'GET - 获取账户余额 (需要 address 参数)',
        '/addWallet': 'POST - 添加钱包地址 (需要 address 参数)',
        '/addWalletsBatch': 'POST - 批量添加钱包地址 (需要 addresses 数组)',
        '/removeWallet': 'POST - 删除钱包地址 (需要 address 参数)',
        '/getWallets': 'GET - 获取钱包地址列表',
        '/health': 'GET - 健康检查'
      }
    }));
  } else if (pathname === '/api/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else if (pathname === '/api/getInfo') {
    const address = query.address as string;

    if (!address) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: '缺少 address 参数' }));
      return;
    }
    
    getInfo(address).then((result:any)=>{
      res.writeHead(200);
      res.end(JSON.stringify(result));
    }).catch(error=>{
      res.writeHead(500);
      res.end(JSON.stringify({ error: '获取交易失败', message: error.message }));
    })
  } else if (pathname === '/api/price') {
    getSolanaPrice()
      .then(price => {
        res.writeHead(200);
        res.end(JSON.stringify({ price, currency: 'USD', timestamp: new Date().toISOString() }));
      })
      .catch(error => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: '获取价格失败', message: error.message }));
      });
  } else if (pathname === '/api/balance') {
    const address = query.address as string;
    if (!address) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: '缺少 address 参数' }));
      return;
    }
    getAccountBalance(address)
      .then(balance => {
        res.writeHead(200);
        res.end(JSON.stringify({ address, balance, unit: 'SOL', timestamp: new Date().toISOString() }));
      })
      .catch(error => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: '获取余额失败', message: error.message }));
      });
  } else if (pathname === '/api/addWallet') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: '仅支持 POST 方法' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const address = data.address;

        if (!address) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: '缺少 address 参数' }));
          return;
        }

        const success = await addWalletAddress(redisClient,address);
        if (success) {
          res.writeHead(200);
          res.end(JSON.stringify({ 
            success: true, 
            message: '钱包地址添加成功', 
            address: address 
          }));
        } else {
          res.writeHead(409);
          res.end(JSON.stringify({ 
            success: false, 
            message: '钱包地址已存在', 
            address: address 
          }));
        }
      } catch (error: any) {
        res.writeHead(400);
        res.end(JSON.stringify({ 
          error: '添加钱包地址失败', 
          message: error.message 
        }));
      }
    });
  } else if (pathname === '/api/addWalletsBatch') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: '仅支持 POST 方法' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const addresses = data.addresses;

        if (!addresses || !Array.isArray(addresses)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: '缺少 addresses 参数或格式不正确' }));
          return;
        }

        if (addresses.length === 0) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: '地址列表不能为空' }));
          return;
        }

        const result = await addWalletAddressesBatch(redisClient,addresses);
        res.writeHead(200);
        res.end(JSON.stringify({ 
          success: true,
          message: '批量添加完成',
          result: {
            total: addresses.length,
            success: result.success.length,
            failed: result.failed.length,
            duplicates: result.duplicates.length,
            successAddresses: result.success,
            failedAddresses: result.failed,
            duplicateAddresses: result.duplicates
          }
        }));
      } catch (error: any) {
        res.writeHead(400);
        res.end(JSON.stringify({ 
          error: '批量添加钱包地址失败', 
          message: error.message 
        }));
      }
    });
  } else if (pathname === '/api/removeWallet') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: '仅支持 POST 方法' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const address = data.address;

        if (!address) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: '缺少 address 参数' }));
          return;
        }

        const success = await removeWalletAddress(redisClient,address);
        if (success) {
          res.writeHead(200);
          res.end(JSON.stringify({ 
            success: true, 
            message: '钱包地址删除成功', 
            address: address 
          }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ 
            success: false, 
            message: '钱包地址不存在', 
            address: address 
          }));
        }
      } catch (error: any) {
        res.writeHead(400);
        res.end(JSON.stringify({ 
          error: '删除钱包地址失败', 
          message: error.message 
        }));
      }
    });

  } else if (pathname === '/api/getWallets') {
    getWalletAddresses(redisClient)
      .then(addresses => {
        res.writeHead(200);
        res.end(JSON.stringify({ 
          success: true,
          count: addresses.length,
          addresses: addresses,
          timestamp: new Date().toISOString() 
        }));
      })
      .catch(error => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: '获取钱包地址列表失败', message: error.message }));
      });
  } else if (pathname === '/api/checkHash') {
    const hash = query.hash as string;
    
    if (!hash) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: '缺少 hash 参数' }));
      return;
    }
    
    redisClient.exists(`hashTx:${hash}`)
      .then(exists => {
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          hash: hash,
          exists: exists === 1,
          message: exists === 1 ? '交易哈希已保存' : '交易哈希未找到',
          timestamp: new Date().toISOString()
        }));
      })
      .catch(error => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: '查询交易哈希失败', message: error.message }));
      });
  } else if (pathname === '/api/getTokenHashes') {
    if (req.method === 'GET') {
      (async () => {
        try {
          const tokenAddress = query.token as string;
          if (!tokenAddress) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, message: '缺少token参数' }));
            return;
          }
          
          // 从Redis列表中获取所有hash
          const hashes = await redisClient.lrange(`txs:${tokenAddress}`, 0, -1);
          
          res.writeHead(200);
          res.end(JSON.stringify({ 
            success: true, 
            token: tokenAddress,
            hashes: hashes,
            count: hashes.length,
            timestamp: new Date().toISOString()
          }));
        } catch (error) {
          console.error('获取代币hash列表时出错:', error);
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, message: '获取代币hash列表失败', error: error instanceof Error ? error.message : String(error) }));
        }
      })();
    } else {
      res.writeHead(405);
      res.end(JSON.stringify({ success: false, message: '方法不允许' }));
    }
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: '路径未找到' }));
  }
}



// 初始化全局钱包地址
async function initializeGlobalWalletAddresses(): Promise<void> {
  try {
    globalWalletAddresses = await getWalletAddresses(redisClient);
    globalWalletAddresses.forEach((item:any)=>{
      ownAddress.set(item,true);
    })
    console.log(`✅ 已加载 ${globalWalletAddresses.length} 个钱包地址到全局变量`);
  } catch (error) {
    console.error('初始化全局钱包地址时出错:', error);
    globalWalletAddresses = [];
  }
}

// 精确的数值运算函数，解决浮点数精度问题
const preciseAdd = (a: number, b: number): number => {
  const factor = Math.pow(10, 12) // 使用12位精度
  return Math.round(a * factor + b * factor) / factor
}

const updateTokenAccountInfo = async (tokenMint: string, walletAddress: string,tokenAccount:string, type: string, balance: number, amount: number, quantity:number) => {
  if (!tokenAccounts[tokenMint]) {
    tokenAccounts[tokenMint] = []
  }
  
  // 查找对应的钱包地址和代币账户的组合
  const existingAccount = tokenAccounts[tokenMint].find(
    account => account.walletAddress === walletAddress
  )
  
  if (existingAccount) {
    if(type == 'sell'){
      existingAccount.sellTotalNumber = existingAccount.sellTotalNumber + 1;
      existingAccount.sellTotalQuantity = preciseAdd(existingAccount.sellTotalQuantity,quantity);
      existingAccount.sellTotalAmount = preciseAdd(existingAccount.sellTotalAmount,amount);
    }
    if(type == 'buy'){
      existingAccount.buyTotalNumber = existingAccount.buyTotalNumber + 1;
      existingAccount.buyTotalQuantity = preciseAdd(existingAccount.buyTotalQuantity,quantity);
      existingAccount.buyTotalAmount = preciseAdd(existingAccount.buyTotalAmount,amount);
    }
    existingAccount.isOwen = ownAddress.get(walletAddress) || false;
    return existingAccount;
  }else{
    if(type == 'buy'){
      const newAccount = {
        walletAddress,
        tokenAccount,
        buyTotalNumber:1,
        buyTotalQuantity:quantity,
        buyTotalAmount:amount,
        sellTotalNumber:0,
        sellTotalQuantity:0,
        sellTotalAmount:0,
        balance: balance,
        isOwen: ownAddress.get(walletAddress) || false
      };
      tokenAccounts[tokenMint].push(newAccount);
      return newAccount;
    }
    if(type == 'sell'){
      const newAccount = {
        walletAddress,
        tokenAccount,
        buyTotalNumber:0,
        buyTotalQuantity:0,
        buyTotalAmount:0,
        sellTotalNumber:1,
        sellTotalQuantity:quantity,
        sellTotalAmount:amount,
        balance: balance,
        isOwen: ownAddress.get(walletAddress) || false
      };
      tokenAccounts[tokenMint].push(newAccount);
      return newAccount;
    }
  }
}

// 创建 WebSocket 服务器
async function createWssServer() {
  // 初始化全局钱包地址
  await initializeGlobalWalletAddresses();
  
  wssServer = new WebSocketServer({ port: WSS_PORT });
  
  console.log(`🔌 WebSocket 服务器启动成功!`);
  console.log(`📡 WebSocket 地址: ws://localhost:${WSS_PORT}`);
  
  wssServer.on('connection', (ws: WebSocket, req) => {
    const clientId = generateClientId();
    console.log(`新的WebSocket客户端连接: ${clientId}`);
    
    // 初始化客户端连接信息
    clientConnections.set(clientId, {
      ws: ws,
      subscriptions: new Set(),
      swapBuffer: []
    });
    
    // 处理客户端消息
    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`收到客户端 ${clientId} 消息:`, message);
        if (message.type === 'subscribe') {
          if(message.data.type == 0){
            handleGrpcSubscribe(clientId, message.data.tokenAddress,message.data.pairAddress);
          }else{
            handleHeliusSubscribe(clientId, message.data.tokenAddress,message.data.pairAddress);
          }
        } else if (message.type === 'ping') {
          // 响应心跳
          let clientInfo2 = clientConnections.get(clientId);
          if (clientInfo2) {
            var swaps = clientInfo2.swapBuffer;
            ws.send(JSON.stringify({ type: 'pong', swaps, tokenAccounts:tokenAccounts[message.tokenAddress]}));
          }
        }
      } catch (error) {
        console.error(`处理客户端 ${clientId} 消息失败:`, error);
        ws.send(JSON.stringify({ error: '消息格式错误' }));
      }
    });
    
    // 处理客户端断开连接
    ws.on('close', () => {
      console.log(`客户端 ${clientId} 断开连接`);
      const clientInfo = clientConnections.get(clientId);
      if (clientInfo?.heliusWs) {
        clientInfo.heliusWs.close();
      }
      clientConnections.delete(clientId);
    });
    
    // 处理连接错误
    ws.on('error', (error) => {
      console.error(`客户端 ${clientId} 连接错误:`, error);
    });
  });
  
  return wssServer;
}

// 生成客户端ID
function generateClientId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// 解析账户信息
function parseAccounts(value: any): string[] {
    const accounts: string[] = [];
    
    // 解析账户密钥
    const accountKeys = value.transaction.message.accountKeys;
    const loadedWritableAddresses = value.meta.loadedWritableAddresses;
    const loadedReadonlyAddresses = value.meta.loadedReadonlyAddresses;
    
    // 将所有账户添加到数组中
    [
        ...accountKeys,
        ...loadedWritableAddresses,
        ...loadedReadonlyAddresses
    ].forEach(ele => {
        accounts.push(base58.encode(Buffer.from(ele, 'base64')));
    });
    
    return accounts;
}
const Token2022Program = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const routerHandlers = [PumpAmm, Raydium, RaydiumCP, RaydiumCLMM];


function jsonrpcDECO(value:any,tokenAddress:string){
  const signature = base58.encode(Buffer.from(value.signature,'base64'))
        
  // 解析账户信息
  const accountKeys = parseAccounts(value);
  const instructions = value.transaction.message.instructions;  //外部指令
  const innerInstructions = value.meta.innerInstructions;       //内部指令
  const postTokenBalances = value.meta.postTokenBalances;       //代币余额
  var tokenProgramIndex = 0;
  var token2022ProgramIndex = 0;
  accountKeys.forEach((account, i) => {
      if(account == TokenProgram){
          tokenProgramIndex = i;
      }
      if(account == Token2022Program){
          token2022ProgramIndex = i;
      }
  })
  var swaps:any[] = [];
  var jupiter:any[] = [];
  var feePayer = accountKeys[0];
  instructions.map((item: any, mainindex: number) => {
    const routertype = swapProgramIds.indexOf(accountKeys[item.programIdIndex]);
    if(routertype>=0){
      item.spltokens  = getSpltokens(accountKeys,innerInstructions,mainindex,tokenProgramIndex,token2022ProgramIndex);
      var discriminator = item.data.subarray(0, 8).readBigUInt64LE();
      item.discriminator = discriminator;
      const handler = routerHandlers[routertype];
      if (handler) {
        const result = handler(item);
        if (result) {
          let {open,close} = result;
          if(open.mint == tokenAddress){
            swaps.push({
              id: signature,
              address: feePayer,
              account: open.source,
              type: 'sell',
              balance:0,
              amount: close.amount,
              quantity: open.amount,
              timestamp: Date.now()
            });
          }else if(close.mint == tokenAddress){
            swaps.push({
              id: signature,
              address: feePayer,
              account: close.destination,
              type: 'buy',
              balance:0,
              amount: open.amount,
              quantity: close.amount,
              timestamp: Date.now()
            });
          }
        }
      }
    }else{
      const inner = innerInstructions.find((insx:any) => insx.index === mainindex)?.instructions || [];
      var spltokens:any[] = [];
      var maininsitem:any = {};
      var router = -1;
      if(inner.length>0){
        inner.forEach((inneritem:any) => {
          const innerRoutertype = swapProgramIds.indexOf(accountKeys[inneritem.programIdIndex]);
          if(innerRoutertype>=0){
            if(router>=0 && spltokens.length>1){
              maininsitem.spltokens = spltokens;
              jupiter.push(maininsitem);
            }
            router = innerRoutertype;
            maininsitem = inneritem;
            maininsitem.router = router;
            spltokens = [];
          }else{
            if(router>=0){
              let isValidProgram = inneritem.programIdIndex === tokenProgramIndex || inneritem.programIdIndex === token2022ProgramIndex;
              if(isValidProgram){
                spltokens.push(insitemFormat(accountKeys,inneritem))
              }
            }
          }
        })
        if(router>=0 && spltokens.length>1){
          maininsitem.spltokens = spltokens;
          jupiter.push(maininsitem);
        }
      }
    }
  })

  if(jupiter.length>0){
    jupiter.forEach((jupiteritem:any) => {
      var discriminator = jupiteritem.data.subarray(0, 8).readBigUInt64LE();
      jupiteritem.discriminator = discriminator;
      const handler2 = routerHandlers[jupiteritem.router];
      if (handler2) {
        const result = handler2(jupiteritem);
        if (result) {
          let {open,close} = result;
          if(open.mint == tokenAddress){
            swaps.push({
              id: signature,
              address: feePayer,
              account: open.source,
              type: 'sell',
              balance:0,
              amount: close.amount,
              quantity: open.amount,
              timestamp: Date.now()
            });
          }else if(close.mint == tokenAddress){
            swaps.push({
              id: signature,
              address: feePayer,
              account: close.destination,
              type: 'buy',
              balance:0,
              amount: open.amount,
              quantity: close.amount,
              timestamp: Date.now()
            });
          }
        }
      }
    })
  }

  if(swaps.length>0){
    const accounts = swaps.map((item: any) => item.account);
    const tokenInfo: { [key: string]: { balance: number; decimals: number } } = {};
    postTokenBalances.forEach((item: any) => {
      const balanceAccount = accountKeys[item.accountIndex];
      if (accounts.includes(balanceAccount)) {
        tokenInfo[balanceAccount] = {
          balance: item.uiTokenAmount.uiAmount,
          decimals: item.uiTokenAmount.decimals,
        };
      }
    });
    swaps.forEach((item:any) => {
      item.balance = tokenInfo[item.account]?.balance || 0;
      //数量
      item.quantity = new Decimal(item.quantity.toString()).div(10**tokenInfo[item.account]?.decimals);
      //金额
      item.amount = new Decimal(item.amount.toString()).div(1e9);
      if (item.quantity.isZero()) {
        item.price = 0;
      } else {
        item.price = item.amount.div(item.quantity);
      }
      updateTokenAccountInfo(
        tokenAddress,
        item.address,
        item.account,
        item.type,
        item.balance,
        item.amount,
        item.quantity
      );
    })
    //console.log(swaps);
  }
  return swaps;
}

async function handleGrpcSubscribe(clientId: string, tokenAddress: string, pairAddress: string) {
  const client = new Client(GRPC_URL, HeliusKey, {
    "grpc.max_receive_message_length": 64 * 1024 * 1024
  });
  const stream = await client.subscribe();
  stream.on("data", (data: { transaction: { transaction: any; slot: any; }; filters: string[]; }) => {
    try {
      if(data?.transaction && data.filters[0] == 'helius'){
        const value = data?.transaction.transaction;
        const clientInfo = clientConnections.get(clientId);
        if (!clientInfo) {
          console.error(`客户端 ${clientId} 不存在`);
          stream.cancel();
          return;
        }
        let swaps = jsonrpcDECO(value, tokenAddress);
        if (swaps.length > 0) {
          swaps.forEach((item:any) => {
            item.isOwen = ownAddress.get(item.address) || false
            // 使用 unshift 在数组开头添加新数据
            clientInfo.swapBuffer.unshift(item);
            // 如果超过20条，使用 pop 移除最旧的数据（数组末尾）
            if (clientInfo.swapBuffer.length > 20) {
              clientInfo.swapBuffer.pop();
            }
          })
        }
      }
    } catch (error) {
        console.error(`处理数据时出错:`, error);
    }
  });

  stream.on('error', (err) => {
    console.error(`与客户端 ${clientId} 的WebSocket连接出错:`, err);
  });
  
  // 配置订阅请求
  const request:SubscribeRequest = {
      accounts: {},
      slots: {},
      transactions: {
          helius: {
              vote: false,
              failed: false,
              signature: undefined,
              accountInclude: [pairAddress],
              accountExclude: [],
              accountRequired: [],
          }
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: 0
  };

  await new Promise<void>((resolve, reject) => {
    stream.write(request, (err:any) => {
      if (err === null || err === undefined) {
        resolve();
      } else {
        reject(err);
      }
    });
  }).catch((reason) => {
    console.error(reason);
  });
}

// 处理交易订阅请求
async function handleHeliusSubscribe(clientId: string, tokenAddress: string, pairAddress: string) {
  const clientInfo = clientConnections.get(clientId);
  if (!clientInfo) {
    console.error(`客户端 ${clientId} 不存在`);
    return;
  }
  
  const { ws } = clientInfo;
  
  if (pairAddress == undefined || pairAddress == '') {
    ws.send(JSON.stringify({ error: '缺少必要的订阅参数' }));
    return;
  }

  console.log(`为客户端 ${clientId} 订阅代币 ${tokenAddress} 的交易`);
  
  // 如果已有Helius连接，先关闭
  if (clientInfo.heliusWs) {
    clientInfo.heliusWs.close();
  }
  
  try {
    // 创建到Helius的WebSocket连接
    const heliusWs = new WebSocket(ATLAS_URL);
    clientInfo.heliusWs = heliusWs;
    clientInfo.swapBuffer = [];
    
    heliusWs.on('open', () => {
      console.log(`为客户端 ${clientId} 建立Helius WebSocket连接`);
      
      // 发送订阅请求到Helius
      const subscriptionRequest = {
        jsonrpc: "2.0",
        id: 420,
        method: "transactionSubscribe",
        params: [
          {
            failed: false,
            accountInclude: [pairAddress]
          },
          {
            commitment: "processed",
            encoding: "jsonParsed",
            transactionDetails: "full",
            showRewards: true,
            maxSupportedTransactionVersion: 0
          }
        ]
      };
      
      heliusWs.send(JSON.stringify(subscriptionRequest));
      console.log(`已向Helius发送订阅请求:`)
      console.log(subscriptionRequest.params);
      
      // 通知客户端连接成功
      ws.send(JSON.stringify({ 
        type: 'connection_established',
        message: '实时数据连接已建立',
        tokenAddress: tokenAddress,
        pairAddress: pairAddress
      }));
    });
    
    heliusWs.on('message', (data: Buffer) => {
      try {
        const messageStr = data.toString();
        const messageObj = JSON.parse(messageStr);

        // 转发Helius消息到客户端
        if (messageObj.params && messageObj.params.result) {
          var result = getTransactionDetails(messageObj.params.result,tokenAddress);
          if(result.swaps.length>0){
            // 转发交易数据到客户端 ${clientId}
            ws.send(JSON.stringify({
              type:'transaction',
              data: result 
            }));
          }
        }
      } catch (error) {
        console.error(`处理Helius消息失败:`, error);
      }
    });
    
    heliusWs.on('error', (error) => {
      console.error(`Helius WebSocket错误 (客户端 ${clientId}):`, error);
      ws.send(JSON.stringify({ 
        type: 'error',
        message: '实时数据连接出错'
      }));
    });
    
    heliusWs.on('close', () => {
      console.error(`Helius WebSocket连接关闭 (客户端 ${clientId})`);
      ws.send(JSON.stringify({ 
        type: 'connection_closed',
        message: '实时数据连接已断开'
      }));
    });
    
    // 添加订阅记录
    clientInfo.subscriptions.add(tokenAddress);
    
  } catch (error) {
    console.error(`创建Helius WebSocket连接失败:`, error);
    ws.send(JSON.stringify({ 
      type: 'error',
      message: '无法建立实时数据连接'
    }));
  }
}

function getTransactionDetails(info: any, tokenAddress: string) {
  var signatures = info.transaction.transaction.signatures;
  var hashTx = signatures[0];
  redisClient.setex(`hashTx:${hashTx}`,3600,1);

  var message = info.transaction.transaction.message;
  var innerInstructions = info.transaction.meta.innerInstructions;
  var instructions = message.instructions;
  const accountKeys = message.accountKeys.map((account: any) => account.pubkey);
  const signers = message.accountKeys.filter((account: any) => account.signer === true);
  const signerPubkeys = signers.map((account: any) => account.pubkey);
  var feePayer = signerPubkeys[0];
  var swaps:any[] = [];
  var jupiter:any[] = [];
  const routerHandlers = [PumpAmm, Raydium, RaydiumCP, RaydiumCLMM];
  instructions.map((item: any, mainindex: number) => {
    const routertype = swapProgramIds.indexOf(item.programId);
    if(routertype>=0){
      item.spltokens  = getHeliusSpltokens(innerInstructions,mainindex);
      
      var hex = Buffer.from(base58.decode(item.data));
      var discriminator = hex.subarray(0, 8).readBigUInt64LE();
      item.discriminator = discriminator;

      // 使用策略模式优化路由处理
      const handler = routerHandlers[routertype];
      if (handler) {
        const result = handler(item);
        if (result) {
          let {open,close} = result;
          if(open.mint == tokenAddress){
            swaps.push({
              id: signatures[0],
              address: feePayer,
              account: open.source,
              type: 'sell',
              balance:0,
              amount: close.tokenAmount.uiAmount,
              quantity: open.tokenAmount.uiAmount,
              timestamp: Date.now()
            });
          }else if(close.mint == tokenAddress){
            swaps.push({
              id: signatures[0],
              address: feePayer,
              account: close.destination,
              type: 'buy',
              balance:0,
              amount: open.tokenAmount.uiAmount,
              quantity: close.tokenAmount.uiAmount,
              timestamp: Date.now()
            });
          }
        }
      }
    }else{
      const inner = innerInstructions.find((insx:any) => insx.index === mainindex)?.instructions || [];
      var spltokens:any[] = [];
      var maininsitem:any = {};
      var router = -1;
      if(inner.length>0){
        inner.forEach((inneritem:any,index:number) => {
          const innerRoutertype = swapProgramIds.indexOf(inneritem.programId);
          if(innerRoutertype>=0){
            if(router>=0 && spltokens.length>1){
                maininsitem.spltokens = spltokens;
                jupiter.push(maininsitem);
            }
            router = innerRoutertype;
            maininsitem = inneritem;
            maininsitem.router = router;
            spltokens = [];
          }else{
            if(router>=0){
              spltokens.push(inneritem.parsed?.info)
            }
          }
        })
        if(router>=0 && spltokens.length>1){
          maininsitem.spltokens = spltokens;
          jupiter.push(maininsitem);
        }
      }
    }
  })
  if(jupiter.length>0){
    jupiter.forEach((jupiteritem:any,index:number) => {
      const handlerJupiter = routerHandlers[jupiteritem.router];
      if (handlerJupiter) {
        var hex = Buffer.from(base58.decode(jupiteritem.data));
        var discriminator = hex.subarray(0, 8).readBigUInt64LE();
        jupiteritem.discriminator = discriminator;
        const result = handlerJupiter(jupiteritem);
        if (result) {
          let {open,close} = result;
          if(open.mint == tokenAddress){
            swaps.push({
              id: signatures[0],
              address: feePayer,
              account: open.source,
              type: 'sell',
              balance:0,
              amount: close.tokenAmount.uiAmount,
              quantity: open.tokenAmount.uiAmount,
              timestamp: Date.now()
            });
          }else if(close.mint == tokenAddress){
            swaps.push({
              id: signatures[0],
              address: feePayer,
              account: close.destination,
              type: 'buy',
              balance:0,
              amount: open.tokenAmount.uiAmount,
              quantity: close.tokenAmount.uiAmount,
              timestamp: Date.now()
            });
          }
        }
      }
    })
  }
   
  // 从swaps中提取account字段组成数组
  const accounts = swaps.map((item: any) => item.account);
  var postTokenBalances = info.transaction.meta.postTokenBalances;

  const balances: { [key: string]: number } = {};

  postTokenBalances.forEach((item:any) => {
    var balanceAccount = accountKeys[item.accountIndex];
    if(accounts.includes(balanceAccount)){
      balances[balanceAccount] = item.uiTokenAmount.uiAmount;
    }
  })

  swaps.forEach((item:any) => {
    item.balance = balances[item.account] || 0;
    if (item.quantity==0) {
      item.price = 0;
    } else {
      item.price = item.amount/item.quantity;
    }
  })
  
  if(swaps.length>0){
     redisClient.lpush(`txs:${tokenAddress}`,hashTx);
  }

  return {swaps,tokenAddress};
}

function getHeliusSpltokens(innerInstructions:any[],mainindex:number):any[]{
  const ins = innerInstructions.find((insx:any) => insx.index === mainindex)?.instructions || [];
  return ins.filter((insx:any) => insx.program === 'spl-token').map((insx:any) => insx.parsed.info);
}

//解析Transfer地址和金额
interface InstructionItem {
  accounts: (number | string)[];
  data: any; 
}

interface FormattedInstruction {
  source: string;
  destination: string;
  authority: string;
  mint?: string;
  amount: any; 
}

function insitemFormat(accounts: string[], insitem: InstructionItem): FormattedInstruction {
  const amount = transferAmountData(insitem.data);

  if (insitem.accounts.length === 4) {
    const [sourceIndex, mintIndex, destinationIndex, authorityIndex] = insitem.accounts as number[];
    return {
      source: accounts[sourceIndex],
      mint: accounts[mintIndex],
      destination: accounts[destinationIndex],
      authority: accounts[authorityIndex],
      amount,
    };
  }

  const [source, destination, authority] = insitem.accounts as string[];
  return {
    source,
    destination,
    authority,
    amount,
  };
}

function getSpltokens(accounts:any[],innerInstructions:any[],mainindex:number,tokenProgramIndex:number,token2022ProgramIndex:number):any[]{
  // 使用可选链和空值合并操作符简化代码
  const ins = innerInstructions.find((insx:any) => insx.index === mainindex)?.instructions || [];
  
  return ins.reduce((tokens: any[], insitem: any) => {
   
      // 处理账户数据
      insitem.accounts = insitem.accounts.length > 0 ? insitem.accounts.toJSON().data : [];
      
      // 只处理符合条件的指令（token程序且账户数量>2）
      const isValidProgram = insitem.programIdIndex === tokenProgramIndex || 
                            insitem.programIdIndex === token2022ProgramIndex;
      
      if (isValidProgram && insitem.accounts.length > 2) {
        //console.log(insitem);
        tokens.push(insitemFormat(accounts,insitem));
      }
      
      return tokens;
  }, []);
}

// 创建 HTTP 服务器
function createServer() {
  const server = http.createServer(handleRequest);
  
  server.listen(PORT, () => {
    console.log(`🚀 Solana Trading API 服务器启动成功!`);
    console.log(`📡 服务器地址: http://localhost:${PORT}`);
    console.log(`📋 API 文档:`);
    console.log(`   GET  /           - API 信息`);
    console.log(`   GET  /health     - 健康检查`);
    console.log(`   GET  /price      - 获取 SOL 价格`);
    console.log(`   GET  /balance?address=<wallet_address> - 获取账户余额`);
    console.log(`   POST /addWallet - 添加钱包地址 (JSON: {"address": "wallet_address"})`);
    console.log(`   POST /addWalletsBatch - 批量添加钱包地址 (JSON: {"addresses": ["addr1", "addr2"]})`);
    console.log(`   POST /removeWallet - 删除钱包地址 (JSON: {"address": "wallet_address"})`);
    console.log(`   GET  /getWallets - 获取钱包地址列表`);
    console.log(`   GET  /checkHash?hash=<transaction_hash> - 查询交易哈希是否已保存`);
    console.log(`   GET  /getTokenHashes?token=<token_address> - 获取代币全部hash推送列表`);
  });

  // 优雅关闭
  process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭服务器...');
    server.close(() => {
      console.log('服务器已关闭');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('\n收到 SIGINT 信号，正在关闭服务器...');
    server.close(() => {
      console.log('服务器已关闭');
      process.exit(0);
    });
  });

  return server;
}

// 主函数
async function main() {
  console.log('Solana Trading API 启动中...');
  createServer();
  createWssServer();
}

// 如果直接运行此文件，则执行主函数
if (require.main === module) {
  main();
}