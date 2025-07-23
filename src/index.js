"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connection = void 0;
exports.getAccountBalance = getAccountBalance;
exports.getSolanaPrice = getSolanaPrice;
exports.createServer = createServer;
exports.createWssServer = createWssServer;
exports.addWalletAddress = addWalletAddress;
exports.addWalletAddressesBatch = addWalletAddressesBatch;
exports.getWalletAddresses = getWalletAddresses;
exports.removeWalletAddress = removeWalletAddress;
exports.getTokenHolderList = getTokenHolderList;
exports.getHoldAnalysis = getHoldAnalysis;
exports.getQueriedTokens = getQueriedTokens;
const axios_1 = __importDefault(require("axios"));
const http = __importStar(require("http"));
const url = __importStar(require("url"));
const ioredis_1 = __importDefault(require("ioredis"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const umi_bundle_defaults_1 = require("@metaplex-foundation/umi-bundle-defaults");
const umi_1 = require("@metaplex-foundation/umi");
const mpl_token_metadata_1 = require("@metaplex-foundation/mpl-token-metadata");
const ws_1 = __importStar(require("ws"));
// Solana 连接配置
const connection = new web3_js_1.Connection('https://mainnet.helius-rpc.com/?api-key=58cb60c2-fcc6-4c96-9910-7123cf351f7a', 'confirmed');
exports.connection = connection;
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PASSWORD || '';
const redisClient = new ioredis_1.default(6379, '127.0.0.1', { password: PASSWORD });
// 连接到 Redis
redisClient.on('error', (err) => {
    console.error('Redis 连接错误:', err);
});
redisClient.on('connect', () => {
    console.log('已连接到 Redis');
});
// 获取账户余额
async function getAccountBalance(publicKeyString) {
    try {
        const publicKey = new web3_js_1.PublicKey(publicKeyString);
        const balance = await connection.getBalance(publicKey);
        return balance / 1e9; // 转换为 SOL
    }
    catch (error) {
        console.error('获取账户余额时出错:', error);
        throw error;
    }
}
// 获取 Solana 价格
async function getSolanaPrice() {
    try {
        const response = await axios_1.default.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        return response.data.solana.usd;
    }
    catch (error) {
        console.error('获取 Solana 价格时出错:', error);
        throw error;
    }
}
function transferAmountData(data) {
    if (data.length === 9) {
        return spl_token_1.transferInstructionData.decode(data).amount;
    }
    else if (data.length === 10) {
        return spl_token_1.transferCheckedInstructionData.decode(data).amount;
    }
    else {
        return 0;
    }
}
// 获取持币数据分析
async function getHoldAnalysis(address) {
    try {
        // 遍历全部的交易记录
        const results = await redisClient.zrevrange(`transactions:${address}`, 0, -1);
        // 钱包分析数据
        const walletAnalysis = {};
        // 遍历所有交易记录
        for (const jsonStr of results) {
            try {
                const transaction = JSON.parse(jsonStr);
                const walletAddress = transaction.address;
                // 初始化钱包数据
                if (!walletAnalysis[walletAddress]) {
                    walletAnalysis[walletAddress] = {
                        walletAddress: walletAddress,
                        tokenAccount: '',
                        balance: 0,
                        buyTotalAmount: 0,
                        buyTotalQuantity: 0,
                        sellTotalAmount: 0,
                        sellTotalQuantity: 0,
                        buyTotalNumber: 0,
                        sellTotalNumber: 0,
                        netAmount: 0,
                        netQuantity: 0,
                        transactionCount: 0
                    };
                }
                const wallet = walletAnalysis[walletAddress];
                wallet.transactionCount++;
                const amount = parseFloat(transaction.amount) || 0;
                const quantity = parseFloat(transaction.quantity) || 0;
                // 根据交易类型统计数据
                if (transaction.type === '买入') {
                    wallet.buyTotalAmount += amount;
                    wallet.buyTotalQuantity += quantity;
                    wallet.buyTotalNumber++;
                }
                else if (transaction.type === '卖出') {
                    wallet.sellTotalAmount += amount;
                    wallet.sellTotalQuantity += quantity;
                    wallet.sellTotalNumber++;
                }
            }
            catch (parseError) {
                console.error('解析交易记录JSON时出错:', parseError);
                continue;
            }
        }
        // 计算净值
        Object.values(walletAnalysis).forEach(wallet => {
            wallet.tokenAccount = getAssociated(wallet.walletAddress, address);
            wallet.balance = 0;
        });
        // 转换为数组并按净持仓量排序
        const walletList = Object.values(walletAnalysis)
            .sort((a, b) => b.netQuantity - a.netQuantity);
        return {
            tokenAddress: address,
            totalWallets: walletList.length,
            totalTransactions: results.length,
            wallets: walletList
        };
    }
    catch (error) {
        console.error('获取持币数据分析时出错:', error);
        throw error;
    }
}
async function getTokenMetadata(mintAddress) {
    try {
        const umi = (0, umi_bundle_defaults_1.createUmi)('https://mainnet.helius-rpc.com/?api-key=58cb60c2-fcc6-4c96-9910-7123cf351f7a');
        const mint = (0, umi_1.publicKey)(mintAddress);
        // 查找元数据PDA
        const metadataPda = (0, mpl_token_metadata_1.findMetadataPda)(umi, { mint });
        // 获取元数据
        const metadata = await (0, mpl_token_metadata_1.fetchMetadata)(umi, metadataPda);
        return {
            name: metadata.name,
            symbol: metadata.symbol,
            uri: metadata.uri,
            mint: mintAddress,
            updateAuthority: metadata.updateAuthority,
            sellerFeeBasisPoints: metadata.sellerFeeBasisPoints
        };
    }
    catch (error) {
        console.error('获取代币元数据时出错:', error);
        return null;
    }
}
async function getInfo(address) {
    const firstTx = await redisClient.get(`first_tx:${address}`) || '';
    var token = {};
    const mint = await redisClient.get(`mint:${address}`);
    if (mint) {
        token = JSON.parse(mint);
    }
    else {
        token = await getTokenMetadata(address);
        redisClient.set(`mint:${address}`, JSON.stringify(token));
    }
    // 将查询过的代币加入到Redis列表中
    try {
        const tokenData = {
            address: address,
            name: token?.name || '',
            symbol: token?.symbol || '',
            timestamp: Date.now()
        };
        // 检查代币是否已存在于列表中
        const exists = await redisClient.sismember('queried_tokens', address);
        if (!exists) {
            // 添加到Set中（去重）
            await redisClient.sadd('queried_tokens', address);
            // 同时添加到有序集合中（按时间排序）
            await redisClient.zadd('queried_tokens_history', Date.now(), JSON.stringify(tokenData));
            console.log(`代币 ${address} 已添加到查询历史列表`);
        }
    }
    catch (error) {
        console.error('添加代币到查询历史时出错:', error);
    }
    return {
        token,
        firstTx
    };
}
async function getTransactions(address, limit = 20, page = 0) {
    const redisKey = `top_signature:${address}`;
    const topSignature = await redisClient.get(redisKey);
    // 从Redis Sorted Set中获取交易记录列表
    var lists = [];
    try {
        const transactionsKey = `transactions:${address}`;
        // 按时间戳倒序获取交易记录（最新的在前）
        var offset = (page - 1) * limit;
        const results = await redisClient.zrevrange(transactionsKey, offset, offset + limit - 1);
        lists = results.map((jsonStr) => {
            try {
                return JSON.parse(jsonStr);
            }
            catch (parseError) {
                console.error('解析交易记录JSON时出错:', parseError);
                return null;
            }
        }).filter((item) => item !== null);
        console.log(`从Redis获取到${lists.length}条交易记录`);
    }
    catch (redisError) {
        console.error('从Redis获取交易记录时出错:', redisError);
    }
    return { topSignature, lists, total: lists.length };
}
function getAssociated(address, mint) {
    return (0, spl_token_1.getAssociatedTokenAddressSync)(new web3_js_1.PublicKey(mint), new web3_js_1.PublicKey(address), true).toString();
}
const swapProgramIds = [
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
];
const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 9,
    useGrouping: false, // 禁用千分位逗号
    maximumFractionDigits: 9
});
async function postTransactions(address, until, before, sina) {
    const lastTx = await redisClient.get(`last_tx:${address}`) || '';
    if (sina == 'start' && lastTx) {
        until = lastTx;
    }
    var tokenAddress = address;
    const apiKey = "7b32bb5c-b850-4965-b632-55acd42c2bf3";
    //const url = 'before=668uC6iG32SRm21urnu5qjWSsVvGZxghWuHsoKFB9C42zchB7dicoxyznV6PBU9akMoh8YgDp3XmTywRKuadug3Y';
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions/?api-key=${apiKey}${until ? `&until=${until}` : ''}${before ? `&before=${before}` : ''}`;
    console.log('');
    console.log('sina: ' + sina);
    console.log(url);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API请求失败: ${response.status}`);
    }
    const data = await response.json();
    console.log('helius', data.length);
    if (data && data.length == 0) {
        console.log('结束查询' + address);
        if (sina == 'post_status') {
            await redisClient.set(`post_status:${address}`, 1);
        }
        return [];
    }
    // 如果有交易数据，将第一条交易的signature存储到Redis
    if (data && data.length > 0) {
        if (before == '') {
            const firstTransaction = data[0];
            if (firstTransaction && firstTransaction.signature) {
                try {
                    const redisKey = `top_signature:${address}`;
                    await redisClient.set(redisKey, firstTransaction.signature);
                }
                catch (redisError) {
                }
            }
        }
    }
    var lastTransaction = '';
    for (const tx of data) {
        lastTransaction = tx.signature;
        var iftx = await redisClient.get('tx:' + tx.signature);
        const events = tx.events;
        const tokenTransfers = tx.tokenTransfers;
        let type = 'unknown';
        let money = 'WSOL';
        let amount = 0;
        let quantity = 0;
        let hasWsol = 0;
        let hasUsdc = 0;
        let hasType = 0;
        if (events?.swap) {
            var tokenInputs = events.swap.tokenInputs;
            var tokenOutputs = events.swap.tokenOutputs;
            if (events.swap.nativeInput == null && events.swap.nativeOutput == null) {
                for (const input of tokenInputs) {
                    if (input.mint == 'So11111111111111111111111111111111111111112') {
                        hasWsol++;
                    }
                    if (input.mint == 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
                        hasUsdc++;
                    }
                    if (input.mint == tokenAddress) {
                        hasType = 1;
                    }
                }
                for (const output of tokenOutputs) {
                    if (output.mint == 'So11111111111111111111111111111111111111112') {
                        hasWsol++;
                    }
                    if (output.mint == 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
                        hasUsdc++;
                    }
                    if (output.mint == tokenAddress) {
                        hasType = 2;
                    }
                }
                if (hasWsol > 0) {
                }
                else if (hasUsdc > 0) {
                    money = 'USDC';
                    if (hasType == 1) {
                        type = '卖出';
                    }
                    if (hasType == 2) {
                        type = '买入';
                        for (const input of tokenInputs) {
                            if (input.mint == 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
                                amount = input.rawTokenAmount.tokenAmount / (10 ** input.rawTokenAmount.decimals);
                            }
                        }
                        for (const output of tokenOutputs) {
                            if (output.mint == tokenAddress) {
                                quantity = output.rawTokenAmount.tokenAmount / (10 ** output.rawTokenAmount.decimals);
                            }
                        }
                    }
                }
            }
            else {
                var nativeInput = events.swap.nativeInput;
                var nativeOutput = events.swap.nativeOutput;
                if (events.swap.nativeInput == null) {
                    type = '卖出';
                    amount = nativeOutput.amount / 1000000000;
                    for (const input of tokenInputs) {
                        if (input.mint == tokenAddress) {
                            quantity = input.rawTokenAmount.tokenAmount / (10 ** input.rawTokenAmount.decimals);
                        }
                    }
                    if (quantity == 0) {
                        for (const transfer of tokenTransfers) {
                            if (transfer.mint == tokenAddress) {
                                quantity = transfer.tokenAmount;
                            }
                        }
                    }
                }
                else {
                    type = '买入';
                    amount = nativeInput.amount / 1000000000;
                    for (const output of tokenOutputs) {
                        if (output.mint == tokenAddress) {
                            quantity = output.rawTokenAmount.tokenAmount / (10 ** output.rawTokenAmount.decimals);
                        }
                    }
                }
            }
        }
        else {
            var swapitem = [];
            var realSwap = [];
            var swapType = '';
            var inToken = 0;
            for (const ins of tx.instructions) {
                if (swapProgramIds.includes(ins.programId)) {
                    swapitem = [];
                    inToken = 0;
                    for (const inner of ins.innerInstructions) {
                        if (inner.accounts.includes(tokenAddress)) {
                            inToken = 1;
                        }
                        swapitem.push(inner);
                    }
                    if (inToken == 0) {
                        swapitem = [];
                    }
                    else {
                        swapType = ins.programId;
                        realSwap = swapitem;
                    }
                }
                else {
                    inToken = 0;
                    swapitem = [];
                    if (ins.innerInstructions.length > 0) {
                        var swap_type = '';
                        for (const inner of ins.innerInstructions) {
                            if (swapProgramIds.includes(inner.programId)) {
                                if (inToken == 1) {
                                    swapType = swap_type;
                                    realSwap = swapitem;
                                }
                                swap_type = inner.programId;
                                swapitem = [];
                                inToken = 0;
                            }
                            else {
                                if (inner.accounts.includes(tokenAddress)) {
                                    inToken = 1;
                                }
                                swapitem.push(inner);
                            }
                        }
                        if (inToken == 1) {
                            realSwap = swapitem;
                        }
                    }
                }
            }
            if (realSwap.length >= 2 && tx.tokenTransfers.length >= 2) {
                var firstSource = realSwap[0].accounts[0];
                var firstDestination = realSwap[0].accounts[2];
                var dierSource = realSwap[1].accounts[0];
                var dierDestination = realSwap[1].accounts[2];
                for (const transfer of tokenTransfers) {
                    if (firstSource == transfer.fromTokenAccount && firstDestination == transfer.toTokenAccount) {
                        if (transfer.mint == tokenAddress) {
                            type = '卖出';
                            quantity = transfer.tokenAmount;
                        }
                        else {
                            if (transfer.mint == 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
                                money = 'USDC';
                            }
                            type = '买入';
                            amount = transfer.tokenAmount;
                        }
                    }
                    if (dierSource == transfer.fromTokenAccount && dierDestination == transfer.toTokenAccount) {
                        if (transfer.mint == tokenAddress) {
                            quantity = transfer.tokenAmount;
                            type = '买入';
                        }
                        else {
                            type = '卖出';
                            amount = transfer.tokenAmount;
                        }
                    }
                }
            }
            if (tx.signature == '2hQt3XCzNczpujQxXKqD8eUR2BZvgAChXbRxDhQMRpvL9zwHEHofTXoBPJ2fBGYD3vzUdhzWDSHA2nPoRFoaqJpg') {
                console.log(type, amount, quantity);
            }
        }
        let saveData = {
            id: tx.signature,
            address: tx.feePayer,
            account: '',
            label: '',
            money,
            type: type,
            amount,
            quantity: formatter.format(quantity),
            timestamp: tx.timestamp ? tx.timestamp * 1000 : Date.now()
        };
        try {
            var redisKey = `transactions:${address}`;
            if (type == 'unknown') {
                redisKey = redisKey + ':unknown';
            }
            else {
                redisClient.set('tx:' + tx.signature, 1);
                saveData.account = await getAssociated(tx.feePayer, address);
                await getTokenAccountBalance(saveData.account);
            }
            if (iftx == null) {
                const score = saveData.timestamp;
                const value = JSON.stringify(saveData);
                await redisClient.zadd(redisKey, score, value).catch((redisError) => {
                    console.error('存储交易记录到Redis时出错:', redisError);
                });
            }
        }
        catch (redisError) {
            console.error('存储交易记录到Redis时出错:', redisError);
        }
    }
    if (data && data.length > 0 && lastTransaction && sina != 'page') {
        // 暂停5秒后继续处理
        setTimeout(() => {
            //postTransactions(address, '', lastTransaction, sina);
        }, 2000);
    }
    const results = await redisClient.zrevrange(`transactions:${address}`, 0, 20);
    const allRecords = results.map((jsonStr) => {
        try {
            return JSON.parse(jsonStr);
        }
        catch (parseError) {
            console.error('解析交易记录JSON时出错:', parseError);
            return null;
        }
    }).filter((item) => item !== null);
    return allRecords;
}
const getTokenAccountBalance = async (tokenAccount) => {
    try {
        const publicKey = new web3_js_1.PublicKey(tokenAccount);
        const accountInfo = await connection.getTokenAccountBalance(publicKey);
        var amount = accountInfo.value.uiAmount || 0;
        return amount;
    }
    catch (error) {
        console.error('查询代币余额失败:', error);
        return 0;
    }
};
// 添加钱包地址到Redis列表
async function addWalletAddress(address) {
    try {
        // 验证地址格式
        new web3_js_1.PublicKey(address);
        // 检查地址是否已存在
        const exists = await redisClient.sismember('wallet_addresses', address);
        if (exists) {
            return false; // 地址已存在
        }
        // 添加地址到Redis Set
        await redisClient.sadd('wallet_addresses', address);
        console.log(`钱包地址 ${address} 已添加到列表`);
        return true;
    }
    catch (error) {
        console.error('添加钱包地址时出错:', error);
        throw error;
    }
}
// 批量添加钱包地址
async function addWalletAddressesBatch(addresses) {
    const result = {
        success: [],
        failed: [],
        duplicates: []
    };
    for (const address of addresses) {
        try {
            // 验证地址格式
            new web3_js_1.PublicKey(address);
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
        }
        catch (error) {
            console.error(`添加钱包地址 ${address} 时出错:`, error);
            result.failed.push(address);
        }
    }
    return result;
}
// 获取钱包地址列表
async function getWalletAddresses() {
    try {
        const addresses = await redisClient.smembers('wallet_addresses');
        return addresses;
    }
    catch (error) {
        console.error('获取钱包地址列表时出错:', error);
        throw error;
    }
}
// 删除单个钱包地址
async function removeWalletAddress(address) {
    try {
        // 验证地址格式
        new web3_js_1.PublicKey(address);
        // 检查地址是否存在
        const exists = await redisClient.sismember('wallet_addresses', address);
        if (!exists) {
            return false; // 地址不存在
        }
        // 从Redis Set中删除地址
        await redisClient.srem('wallet_addresses', address);
        console.log(`钱包地址 ${address} 已从列表中删除`);
        return true;
    }
    catch (error) {
        console.error('删除钱包地址时出错:', error);
        throw error;
    }
}
// 获取查询过的代币项目列表
async function getQueriedTokens(limit = 50, offset = 0) {
    try {
        // 从有序集合中获取代币列表（按时间倒序）
        const results = await redisClient.zrevrange('queried_tokens_history', offset, offset + limit - 1);
        const tokens = results.map((jsonStr) => {
            try {
                return JSON.parse(jsonStr);
            }
            catch (parseError) {
                console.error('解析代币数据JSON时出错:', parseError);
                return null;
            }
        }).filter((item) => item !== null);
        // 获取总数
        const total = await redisClient.zcard('queried_tokens_history');
        return {
            success: true,
            data: tokens,
            total: total,
            limit: limit,
            offset: offset,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        console.error('获取查询过的代币列表时出错:', error);
        throw error;
    }
}
// 删除代币记录
async function deleteToken(address) {
    try {
        // 从Set中删除代币地址
        const removedFromSet = await redisClient.srem('queried_tokens', address);
        // 从有序集合中删除代币记录
        // 首先获取所有记录，找到匹配的记录并删除
        const allRecords = await redisClient.zrange('queried_tokens_history', 0, -1);
        let removedFromZSet = 0;
        for (const record of allRecords) {
            try {
                const tokenData = JSON.parse(record);
                if (tokenData.address === address) {
                    await redisClient.zrem('queried_tokens_history', record);
                    removedFromZSet++;
                }
            }
            catch (parseError) {
                console.error('解析代币记录时出错:', parseError);
            }
        }
        // 删除相关的缓存数据
        const keysToDelete = [
            `mint:${address}`,
            `first_tx:${address}`,
            `last_tx:${address}`,
            `transactions:${address}`,
            `top_signature:${address}`
        ];
        for (const key of keysToDelete) {
            await redisClient.del(key);
        }
        console.log(`代币 ${address} 已从查询历史中删除`);
        return {
            success: true,
            message: '代币记录删除成功',
            address: address,
            removedFromSet: removedFromSet > 0,
            removedFromHistory: removedFromZSet > 0,
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        console.error('删除代币记录时出错:', error);
        throw error;
    }
}
// 获取代币持仓地址列表
async function getTokenHolderList(tokenAddress, pageSize = 100, pageNext = 1) {
    try {
        const apiUrl = `https://debot.ai/api/token/profiler/tokenHolderList?token=${tokenAddress}&chain=solana&page_size=${pageSize}&next=${pageNext}`;
        console.log('请求持仓地址API:', apiUrl);
        const response = await axios_1.default.get(apiUrl, {
            timeout: 10000, // 10秒超时
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        if (response.data && response.data.code === 0) {
            return {
                success: true,
                data: response.data.data,
                timestamp: new Date().toISOString()
            };
        }
        else {
            throw new Error(`API返回错误: ${response.data?.description || '未知错误'}`);
        }
    }
    catch (error) {
        console.error('获取代币持仓地址列表时出错:', error);
        throw new Error(`获取持仓地址失败: ${error.message}`);
    }
}
// 处理 HTTP 请求
function handleRequest(req, res) {
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
                '/getTransactions': 'GET - 获取交易记录列表 (需要 address 参数, 可选 limit, offset)',
                '/postTransactions': 'GET - 拉取并存储交易记录 (需要 address 参数, 可选 before)',
                '/addWallet': 'POST - 添加钱包地址 (需要 address 参数)',
                '/addWalletsBatch': 'POST - 批量添加钱包地址 (需要 addresses 数组)',
                '/removeWallet': 'POST - 删除钱包地址 (需要 address 参数)',
                '/getWallets': 'GET - 获取钱包地址列表',
                '/saveFirstTx': 'POST - 保存代币第一笔交易 (需要 address 和 first_tx 参数)',
                '/getTokenHolders': 'GET - 获取代币持仓地址列表 (需要 token 参数, 可选 page_size)',
                '/getHoldAnalysis': 'GET - 获取持币数据分析 (需要 address 参数)',
                '/getQueriedTokens': 'GET - 获取查询过的代币项目列表 (可选 limit, offset)',
                '/deleteToken': 'POST - 删除代币记录 (需要 address 参数)',
                '/health': 'GET - 健康检查'
            }
        }));
    }
    else if (pathname === '/api/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    }
    else if (pathname === '/api/getInfo') {
        const address = query.address;
        if (!address) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: '缺少 address 参数' }));
            return;
        }
        getInfo(address).then((result) => {
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }).catch(error => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: '获取交易失败', message: error.message }));
        });
    }
    else if (pathname === '/api/getTransactions') {
        const address = query.address;
        const limit = parseInt(query.pageSize) || 20;
        const page = parseInt(query.page) || 0;
        if (!address) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: '缺少 address 参数' }));
            return;
        }
        getTransactions(address, limit, page).then((result) => {
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }).catch(error => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: '获取交易失败', message: error.message }));
        });
    }
    else if (pathname === '/api/postTransactions') {
        const address = query.address;
        const before = query.before;
        if (!address) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: '缺少 address 参数' }));
            return;
        }
        postTransactions(address, '', before, 'start').then(result => {
            res.writeHead(200);
            res.end(JSON.stringify(result));
        }).catch(error => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: '获取交易失败', message: error.message }));
        });
    }
    else if (pathname === '/api/price') {
        getSolanaPrice()
            .then(price => {
            res.writeHead(200);
            res.end(JSON.stringify({ price, currency: 'USD', timestamp: new Date().toISOString() }));
        })
            .catch(error => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: '获取价格失败', message: error.message }));
        });
    }
    else if (pathname === '/api/balance') {
        const address = query.address;
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
    }
    else if (pathname === '/api/addWallet') {
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
                const success = await addWalletAddress(address);
                if (success) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: true,
                        message: '钱包地址添加成功',
                        address: address
                    }));
                }
                else {
                    res.writeHead(409);
                    res.end(JSON.stringify({
                        success: false,
                        message: '钱包地址已存在',
                        address: address
                    }));
                }
            }
            catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: '添加钱包地址失败',
                    message: error.message
                }));
            }
        });
    }
    else if (pathname === '/api/addWalletsBatch') {
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
                const result = await addWalletAddressesBatch(addresses);
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
            }
            catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: '批量添加钱包地址失败',
                    message: error.message
                }));
            }
        });
    }
    else if (pathname === '/api/removeWallet') {
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
                const success = await removeWalletAddress(address);
                if (success) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: true,
                        message: '钱包地址删除成功',
                        address: address
                    }));
                }
                else {
                    res.writeHead(404);
                    res.end(JSON.stringify({
                        success: false,
                        message: '钱包地址不存在',
                        address: address
                    }));
                }
            }
            catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: '删除钱包地址失败',
                    message: error.message
                }));
            }
        });
    }
    else if (pathname === '/api/getWallets') {
        getWalletAddresses()
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
    }
    else if (pathname === '/api/saveFirstTx') {
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
                const firstTx = data.first_tx;
                const hashTx = await redisClient.get(`first_tx:${address}`) || '';
                if (hashTx) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: '已存在' }));
                    return;
                }
                if (!address) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: '缺少 address 参数' }));
                    return;
                }
                if (!firstTx) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: '缺少 first_tx 参数' }));
                    return;
                }
                // 保存代币的第一笔交易到 Redis
                const redisKey = `first_tx:${address}`;
                await redisClient.set(redisKey, firstTx);
                console.log(`代币 ${address} 的第一笔交易已保存到 Redis`);
                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    message: '第一笔交易保存成功',
                    address: address,
                    timestamp: new Date().toISOString()
                }));
            }
            catch (error) {
                console.error('保存第一笔交易时出错:', error);
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: '保存第一笔交易失败',
                    message: error.message
                }));
            }
        });
    }
    else if (pathname === '/api/saveLastTx') {
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
                const lastTx = data.last_tx;
                if (!address) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: '缺少 address 参数' }));
                    return;
                }
                if (!lastTx) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: '缺少 last_tx 参数' }));
                    return;
                }
                // 保存代币的第一笔交易到 Redis
                const redisKey = `last_tx:${address}`;
                await redisClient.set(redisKey, lastTx);
                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    message: '第一笔交易保存成功',
                    address: address,
                    timestamp: new Date().toISOString()
                }));
            }
            catch (error) {
                console.error('保存第一笔交易时出错:', error);
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: '保存第一笔交易失败',
                    message: error.message
                }));
            }
        });
    }
    else if (pathname === '/api/getTokenHolders') {
        const token = query.token;
        const pageSize = parseInt(query.page_size) || 100;
        const pageNext = parseInt(query.next) || 1;
        if (!token) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: '缺少 token 参数' }));
            return;
        }
        getTokenHolderList(token, pageSize, pageNext)
            .then(result => {
            res.writeHead(200);
            res.end(JSON.stringify({
                success: true,
                token: token,
                page_size: pageSize,
                page_next: pageNext,
                data: result,
                timestamp: new Date().toISOString()
            }));
        })
            .catch(error => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: '获取代币持仓地址失败', message: error.message }));
        });
    }
    else if (pathname === '/api/getHoldAnalysis') {
        const address = query.address;
        if (!address) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: '缺少 address 参数' }));
            return;
        }
        getHoldAnalysis(address)
            .then(result => {
            res.writeHead(200);
            res.end(JSON.stringify({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            }));
        })
            .catch(error => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: '获取持币数据分析失败', message: error.message }));
        });
    }
    else if (pathname === '/api/getQueriedTokens') {
        const limit = parseInt(query.limit) || 50;
        const offset = parseInt(query.offset) || 0;
        getQueriedTokens(limit, offset)
            .then(result => {
            res.writeHead(200);
            res.end(JSON.stringify(result));
        })
            .catch(error => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: '获取代币项目列表失败', message: error.message }));
        });
    }
    else if (pathname === '/api/checkHash') {
        const hash = query.hash;
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
    }
    else if (pathname === '/api/deleteToken') {
        if (req.method !== 'POST') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: '仅支持 DELETE 方法' }));
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
                const result = await deleteToken(address);
                res.writeHead(200);
                res.end(JSON.stringify(result));
            }
            catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({
                    error: '删除代币记录失败',
                    message: error.message
                }));
            }
        });
    }
    else if (pathname === '/api/getTokenHashes') {
        if (req.method === 'GET') {
            (async () => {
                try {
                    const tokenAddress = query.token;
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
                }
                catch (error) {
                    console.error('获取代币hash列表时出错:', error);
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, message: '获取代币hash列表失败', error: error instanceof Error ? error.message : String(error) }));
                }
            })();
        }
        else {
            res.writeHead(405);
            res.end(JSON.stringify({ success: false, message: '方法不允许' }));
        }
    }
    else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: '路径未找到' }));
    }
}
// WebSocket 服务器相关变量
let wssServer;
const clientConnections = new Map();
// 创建 WebSocket 服务器
function createWssServer() {
    const WSS_PORT = 18080;
    wssServer = new ws_1.WebSocketServer({ port: WSS_PORT });
    console.log(`🔌 WebSocket 服务器启动成功!`);
    console.log(`📡 WebSocket 地址: ws://localhost:${WSS_PORT}`);
    wssServer.on('connection', (ws, req) => {
        const clientId = generateClientId();
        console.log(`新的WebSocket客户端连接: ${clientId}`);
        // 初始化客户端连接信息
        clientConnections.set(clientId, {
            ws: ws,
            subscriptions: new Set()
        });
        // 处理客户端消息
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log(`收到客户端 ${clientId} 消息:`, message);
                if (message.type === 'subscribe') {
                    await handleTransactionSubscribe(clientId, message.data.tokenAddress, message.data.pairAddress);
                }
                else if (message.type === 'ping') {
                    // 响应心跳
                    ws.send(JSON.stringify({ type: 'pong' }));
                }
            }
            catch (error) {
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
function generateClientId() {
    return Math.random().toString(36).substring(2, 15);
}
// 处理交易订阅请求
async function handleTransactionSubscribe(clientId, tokenAddress, pairAddress) {
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
        const heliusWs = new ws_1.default('wss://atlas-mainnet.helius-rpc.com/?api-key=7b32bb5c-b850-4965-b632-55acd42c2bf3');
        clientInfo.heliusWs = heliusWs;
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
            console.log(`已向Helius发送订阅请求:`, subscriptionRequest.params);
            // 通知客户端连接成功
            ws.send(JSON.stringify({
                type: 'connection_established',
                message: '实时数据连接已建立',
                tokenAddress: tokenAddress,
                pairAddress: pairAddress
            }));
        });
        heliusWs.on('message', (data) => {
            try {
                const messageStr = data.toString();
                const messageObj = JSON.parse(messageStr);
                // 转发Helius消息到客户端
                if (messageObj.params && messageObj.params.result) {
                    var result = getTransactionDetails(messageObj.params.result, tokenAddress);
                    if (result.swaps.length > 0) {
                        //console.log(`转发交易数据到客户端 ${clientId}`);
                        ws.send(JSON.stringify({
                            type: 'transaction',
                            data: result
                        }));
                    }
                }
            }
            catch (error) {
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
            console.log(`Helius WebSocket连接关闭 (客户端 ${clientId})`);
            ws.send(JSON.stringify({
                type: 'connection_closed',
                message: '实时数据连接已断开'
            }));
        });
        // 添加订阅记录
        clientInfo.subscriptions.add(tokenAddress);
    }
    catch (error) {
        console.error(`创建Helius WebSocket连接失败:`, error);
        ws.send(JSON.stringify({
            type: 'error',
            message: '无法建立实时数据连接'
        }));
    }
}
const bs58_1 = __importDefault(require("bs58"));
function getTransactionDetails(info, tokenAddress) {
    var signatures = info.transaction.transaction.signatures;
    var hashTx = signatures[0];
    redisClient.setex(`hashTx:${hashTx}`, 3600, 1);
    var message = info.transaction.transaction.message;
    var innerInstructions = info.transaction.meta.innerInstructions;
    var instructions = message.instructions;
    const accountKeys = message.accountKeys.map((account) => account.pubkey);
    // 找出signer为true的账户
    const signers = message.accountKeys.filter((account) => account.signer === true);
    // 获取signer账户的pubkey
    const signerPubkeys = signers.map((account) => account.pubkey);
    var swaps = [];
    var jupiter = [];
    const routerHandlers = [PumpAmm, Raydium, RaydiumCP, RaydiumCLMM];
    instructions.map((item, mainindex) => {
        //var programId = accounts[item.programIdIndex];
        const routertype = swapProgramIds.indexOf(item.programId);
        if (routertype >= 0) {
            item.spltokens = getSpltokens(innerInstructions, mainindex);
            var hex = Buffer.from(bs58_1.default.decode(item.data));
            var discriminator = hex.subarray(0, 8).readBigUInt64LE();
            item.discriminator = discriminator;
            // 使用策略模式优化路由处理
            const handler = routerHandlers[routertype];
            if (handler) {
                const result = handler(item);
                if (result) {
                    let { open, close, feePayer } = result;
                    if (feePayer == '') {
                        if (signerPubkeys.length > 0) {
                            feePayer = signerPubkeys[0];
                        }
                    }
                    if (open.mint == tokenAddress) {
                        swaps.push({
                            id: signatures[0],
                            address: feePayer,
                            account: open.source,
                            type: 'sell',
                            balance: 0,
                            amount: close.tokenAmount.uiAmount,
                            quantity: open.tokenAmount.uiAmount,
                            timestamp: Date.now()
                        });
                    }
                    else if (close.mint == tokenAddress) {
                        swaps.push({
                            id: signatures[0],
                            address: feePayer,
                            account: close.destination,
                            type: 'buy',
                            balance: 0,
                            amount: open.tokenAmount.uiAmount,
                            quantity: close.tokenAmount.uiAmount,
                            timestamp: Date.now()
                        });
                    }
                }
            }
        }
        else {
            const inner = innerInstructions.find((insx) => insx.index === mainindex)?.instructions || [];
            var spltokens = [];
            var maininsitem = {};
            var router = -1;
            if (inner.length > 0) {
                inner.forEach((inneritem, index) => {
                    const innerRoutertype = swapProgramIds.indexOf(inneritem.programId);
                    if (innerRoutertype >= 0) {
                        if (router >= 0 && spltokens.length > 1) {
                            maininsitem.spltokens = spltokens;
                            jupiter.push(maininsitem);
                        }
                        router = innerRoutertype;
                        maininsitem = inneritem;
                        maininsitem.router = router;
                        spltokens = [];
                    }
                    else {
                        if (router >= 0) {
                            spltokens.push(inneritem.parsed?.info);
                        }
                    }
                });
                if (router >= 0 && spltokens.length > 1) {
                    maininsitem.spltokens = spltokens;
                    jupiter.push(maininsitem);
                }
            }
        }
    });
    if (jupiter.length > 0) {
        jupiter.forEach((jupiteritem, index) => {
            var hex = Buffer.from(bs58_1.default.decode(jupiteritem.data));
            var discriminator = hex.subarray(0, 8).readBigUInt64LE();
            jupiteritem.discriminator = discriminator;
            // console.log(signatures[0]);
            //  console.log(jupiteritem);
            const handler2 = routerHandlers[jupiteritem.router];
            if (handler2) {
                const result = handler2(jupiteritem);
                if (result) {
                    let { open, close, feePayer } = result;
                    if (feePayer == '') {
                        if (signerPubkeys.length > 0) {
                            feePayer = signerPubkeys[0];
                        }
                    }
                    if (open.mint == tokenAddress) {
                        swaps.push({
                            id: signatures[0],
                            address: feePayer,
                            account: open.source,
                            type: 'sell',
                            balance: 0,
                            amount: close.tokenAmount.uiAmount,
                            quantity: open.tokenAmount.uiAmount,
                            timestamp: Date.now()
                        });
                    }
                    else if (close.mint == tokenAddress) {
                        swaps.push({
                            id: signatures[0],
                            address: feePayer,
                            account: close.destination,
                            type: 'buy',
                            balance: 0,
                            amount: open.tokenAmount.uiAmount,
                            quantity: close.tokenAmount.uiAmount,
                            timestamp: Date.now()
                        });
                    }
                }
            }
        });
    }
    // 从swaps中提取account字段组成数组
    const accounts = swaps.map((item) => item.account);
    var postTokenBalances = info.transaction.meta.postTokenBalances;
    //console.log(signatures[0]);
    //console.log(swaps);
    //console.log(accounts);
    const balances = {};
    postTokenBalances.forEach((item) => {
        var balanceAccount = accountKeys[item.accountIndex];
        if (accounts.includes(balanceAccount)) {
            balances[balanceAccount] = item.uiTokenAmount.uiAmount;
        }
    });
    //console.log(balances);
    swaps.forEach((item) => {
        // 如果不存在则balance设为0
        item.balance = balances[item.account] || 0;
    });
    if (swaps.length > 0) {
        redisClient.lpush(`txs:${tokenAddress}`, hashTx);
    }
    return { swaps, tokenAddress };
}
const RaydiumCP = (item) => {
    if (item.discriminator == 2495396153584390839n)
        return; //Remove liquidity
    if (item.discriminator == 17121445590508351407n)
        return; //Add liquidity
    if (item.discriminator == 6448665121156532360n)
        return; //collectProtocolFee
    if (item.discriminator == 13182846803881894898n)
        return; //Add liquidity
    if (item.discriminator == 9081159964177631911n)
        return; //collectFundFee
    const [open, close] = item.spltokens;
    if (open == undefined || close == undefined) {
        return;
    }
    var feePayer = '';
    return { open, close, feePayer };
};
const Raydium = (item) => {
    if (item.discriminator != 9n && item.discriminator != 11n)
        return;
    const [open, close] = item.spltokens;
    if (open == undefined || close == undefined) {
        return;
    }
    var feePayer = '';
    return { open, close, feePayer };
};
const PumpAmm = (item) => {
    if (item.discriminator != 16927863322537952870n && item.discriminator != 12502976635542562355n)
        return;
    if (item.discriminator == 16927863322537952870n) { // 买
        var [close, open] = item.spltokens;
    }
    if (item.discriminator == 12502976635542562355n) { // 卖
        var [open, close] = item.spltokens;
    }
    if (open == undefined || close == undefined) {
        return;
    }
    return { open, close, feePayer: item.accounts[1] };
};
const RaydiumCLMM = (item) => {
    if (item.discriminator == BigInt('3371258220158844749'))
        return;
    if (item.discriminator == BigInt('6972788623384805178'))
        return;
    if (item.discriminator == BigInt('6448665121156532360'))
        return;
    if (item.discriminator == BigInt('14407391725566474317'))
        return;
    if (item.discriminator == BigInt('9081159964177631911'))
        return;
    const [open, close] = item.spltokens;
    if (open == undefined || close == undefined) {
        return;
    }
    var feePayer = '';
    return { open, close, feePayer };
};
function getSpltokens(innerInstructions, mainindex) {
    const ins = innerInstructions.find((insx) => insx.index === mainindex)?.instructions || [];
    return ins.filter((insx) => insx.program === 'spl-token').map((insx) => insx.parsed.info);
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
        console.log(`   GET  /getTransactions?address=<wallet_address>&limit=20&offset=0 - 获取交易记录列表`);
        console.log(`   GET  /postTransactions?address=<wallet_address>&before=<signature> - 拉取并存储交易记录`);
        console.log(`   POST /addWallet - 添加钱包地址 (JSON: {"address": "wallet_address"})`);
        console.log(`   POST /saveFirstTx - 保存代币第一笔交易 (JSON: {"address": "token_address", "first_tx": "transaction_data"})`);
        console.log(`   POST /addWalletsBatch - 批量添加钱包地址 (JSON: {"addresses": ["addr1", "addr2"]})`);
        console.log(`   POST /removeWallet - 删除钱包地址 (JSON: {"address": "wallet_address"})`);
        console.log(`   GET  /getFirstTx?address=<token_address> - 获取代币第一笔交易`);
        console.log(`   GET  /getWallets - 获取钱包地址列表`);
        console.log(`   GET  /getTokenHolders?token=<token_address>&page_size=100 - 获取代币持仓地址列表`);
        console.log(`   GET  /getHoldAnalysis?address=<token_address> - 获取持币数据分析`);
        console.log(`   GET  /checkHash?hash=<transaction_hash> - 查询交易哈希是否已保存`);
        console.log(`   GET  /getTokenHashes?token=<token_address> - 获取代币全部hash推送列表`);
        console.log(`   GET  /getQueriedTokens?limit=50&offset=0 - 获取查询代币列表`);
        console.log(`   POST /deleteToken - 删除代币 (JSON: {"address": "token_address"})`);
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
