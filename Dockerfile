FROM node:18-slim

WORKDIR /app

# 安装 better-sqlite3 编译所需的构建工具
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# 复制依赖声明并安装
COPY package.json ./
RUN npm install --production

# 复制项目代码
COPY . .

# 创建数据目录（SQLite 存放位置）
RUN mkdir -p data

# 暴露端口（腾讯云通过环境变量 PORT 注入）
EXPOSE 3000

# 启动服务
CMD ["node", "server.js"]
