# Solana Trading API

一个基于 TypeScript 的 Solana 区块链交易 API 项目。

## 功能特性

- 🔗 连接到 Solana 区块链网络
- 💰 查询账户余额
- 📈 获取 SOL 价格信息
- 🛠️ TypeScript 支持
- 📦 模块化设计

## 技术栈

- **TypeScript** - 类型安全的 JavaScript
- **@solana/web3.js** - Solana 区块链交互库
- **axios** - HTTP 客户端
- **Node.js** - 运行时环境

## 安装依赖

```bash
npm install
```

## 使用方法

### 开发模式

```bash
npm run dev
```

### 构建项目

```bash
npm run build
```

### 运行编译后的代码

```bash
npm start
```

## 项目结构

```
solana-tradeing-api/
├── src/
│   └── index.ts          # 主入口文件
├── dist/                 # 编译输出目录
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript 配置
└── README.md            # 项目说明
```

## API 功能

### 获取账户余额

```typescript
import { getAccountBalance } from './src/index';

const balance = await getAccountBalance('your-wallet-address');
console.log(`余额: ${balance} SOL`);
```

### 获取 SOL 价格

```typescript
import { getSolanaPrice } from './src/index';

const price = await getSolanaPrice();
console.log(`当前价格: $${price}`);
```

## 配置说明

- 默认连接到 Solana Devnet
- 价格数据来源：CoinGecko API
- 支持自定义 RPC 端点

## 开发注意事项

1. 确保网络连接正常
2. Devnet 用于开发测试
3. 生产环境请切换到 Mainnet
4. 注意 API 调用频率限制

## 许可证

ISC