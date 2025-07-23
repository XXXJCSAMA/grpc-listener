# Redis 配置说明

## 功能说明

本项目已集成 Redis 功能，用于存储每次 `getTransactions` 查询的第一条交易数据的 signature。

## Redis 配置

### 环境变量

可以通过以下环境变量配置 Redis 连接：

```bash
REDIS_HOST=localhost     # Redis 服务器地址，默认 localhost
REDIS_PORT=6379          # Redis 端口，默认 6379
REDIS_PASSWORD=          # Redis 密码，可选
```

### 本地 Redis 安装

#### macOS (使用 Homebrew)
```bash
brew install redis
brew services start redis
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
```

#### Docker
```bash
docker run -d --name redis -p 6379:6379 redis:latest
```

## 存储格式

- **Key 格式**: `tx_signature:{address}:{timestamp}`
- **Value**: 交易的 signature 字符串

### 示例
```
Key: tx_signature:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM:1704067200000
Value: 5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBDLSlsbHp2fyGV88K1Aqv3C7vTdHDau9krVX
```

## 使用说明

1. 确保 Redis 服务正在运行
2. 安装项目依赖：`npm install`
3. 启动服务：`npm run dev`
4. 调用 `/transactions?address=<wallet_address>` 接口
5. 查看控制台日志确认 signature 已存储到 Redis

## 验证存储

可以使用 Redis CLI 验证数据是否正确存储：

```bash
redis-cli
127.0.0.1:6379> KEYS tx_signature:*
127.0.0.1:6379> GET tx_signature:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM:1704067200000
```