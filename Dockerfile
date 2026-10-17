FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV PORT=7000 DATA_DIR=/data
VOLUME /data
EXPOSE 7000
CMD ["node", "src/server.js"]
