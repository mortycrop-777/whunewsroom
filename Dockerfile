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

# 设置环境变量，让应用监听 80 端口（与 K8s 探针端口对齐）
ENV PORT=80

# 暴露端口
EXPOSE 80

# 启动服务
CMD ["node", "server.js"]
