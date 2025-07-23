# WebSocket 服务器使用说明

## 概述

本项目现在包含一个WebSocket服务器，用于转发Solana区块链的实时交易数据。该服务器作为客户端和Helius WebSocket API之间的代理，提供实时的代币交易监控功能。

## 服务器信息

- **WebSocket地址**: `ws://localhost:8080`
- **HTTP API地址**: `http://localhost:3000`

## 功能特性

1. **实时交易订阅**: 订阅特定代币地址的实时交易数据
2. **多客户端支持**: 支持多个客户端同时连接
3. **心跳机制**: 支持客户端心跳保持连接
4. **错误处理**: 完善的错误处理和状态通知
5. **自动重连**: 后端自动管理与Helius的连接

## 使用方法

### 1. 启动服务器

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

### 2. 连接WebSocket

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => {
    console.log('WebSocket连接已建立');
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('收到消息:', data);
};

ws.onerror = (error) => {
    console.error('WebSocket错误:', error);
};

ws.onclose = () => {
    console.log('WebSocket连接已关闭');
};
```

### 3. 订阅交易数据

```javascript
// 订阅特定代币的交易
const subscriptionRequest = {
    jsonrpc: "2.0",
    id: 420,
    method: "transactionSubscribe",
    params: [
        {
            failed: false,
            accountInclude: ["代币地址"]
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

ws.send(JSON.stringify(subscriptionRequest));
```

### 4. 发送心跳

```javascript
// 发送心跳保持连接
ws.send(JSON.stringify({ type: 'ping' }));

// 服务器会响应
// { type: 'pong' }
```

## 消息格式

### 客户端发送的消息

1. **交易订阅请求**:
```json
{
    "jsonrpc": "2.0",
    "id": 420,
    "method": "transactionSubscribe",
    "params": [
        {
            "failed": false,
            "accountInclude": ["代币地址"]
        },
        {
            "commitment": "processed",
            "encoding": "jsonParsed",
            "transactionDetails": "full",
            "showRewards": true,
            "maxSupportedTransactionVersion": 0
        }
    ]
}
```

2. **心跳消息**:
```json
{
    "type": "ping"
}
```

### 服务器发送的消息

1. **连接建立通知**:
```json
{
    "type": "connection_established",
    "message": "实时数据连接已建立",
    "tokenAddress": "代币地址"
}
```

2. **心跳响应**:
```json
{
    "type": "pong"
}
```

3. **错误消息**:
```json
{
    "type": "error",
    "message": "错误描述"
}
```

4. **连接关闭通知**:
```json
{
    "type": "connection_closed",
    "message": "实时数据连接已断开"
}
```

5. **实时交易数据**: 直接转发来自Helius的交易数据

## 测试

项目包含一个测试页面 `test-websocket.html`，可以用来测试WebSocket功能：

1. 在浏览器中打开 `test-websocket.html`
2. 点击"连接"按钮连接到WebSocket服务器
3. 输入代币地址并点击"订阅交易"开始监控
4. 查看消息日志了解实时数据

## 与前端集成

在Vue.js应用中使用：

```javascript
// 替换原来的Helius WebSocket连接
// 从: wss://atlas-mainnet.helius-rpc.com/?api-key=xxx
// 改为: ws://localhost:8080

const startWebSocketConnection = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('WebSocket 已连接，跳过重复连接')
        return
    }
    
    try {
        // 连接到本地WebSocket服务器
        ws = new WebSocket('ws://localhost:8080')
        
        ws.onopen = () => {
            console.log('WebSocket 连接已建立')
            wsConnected.value = true
            ElMessage.success('实时数据连接已建立')
            
            // 发送订阅请求
            sendSubscriptionRequest()
        }
        
        ws.onmessage = (event) => {
            try {
                const messageObj = JSON.parse(event.data)
                
                if (messageObj.params && messageObj.params.result) {
                    // 处理实时交易数据
                    const txData = messageObj.params.result
                    processRealtimeTransaction(txData)
                } else if (messageObj.type === 'connection_established') {
                    ElMessage.success(messageObj.message)
                } else if (messageObj.type === 'error') {
                    ElMessage.error(messageObj.message)
                }
            } catch (error) {
                console.error('解析WebSocket消息失败:', error)
            }
        }
        
        // ... 其他事件处理保持不变
    } catch (error) {
        console.error('创建WebSocket连接失败:', error)
        ElMessage.error('无法建立实时数据连接')
    }
}
```

## 注意事项

1. 确保Redis服务器正在运行
2. 确保端口8080和3000没有被其他应用占用
3. 每个客户端连接都会创建一个对应的Helius WebSocket连接
4. 客户端断开连接时，对应的Helius连接也会自动关闭
5. 服务器会为每个客户端分配唯一的ID用于日志追踪

## 故障排除

1. **连接失败**: 检查服务器是否正常启动，端口是否被占用
2. **无法接收数据**: 检查代币地址是否正确，网络连接是否正常
3. **频繁断开**: 检查网络稳定性，考虑增加重连机制
4. **性能问题**: 监控服务器资源使用情况，考虑限制并发连接数