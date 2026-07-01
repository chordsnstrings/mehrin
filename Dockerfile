# Mehrin — build the TypeScript server + client, run the static + API server.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Purchases are stored as a JSON file here. Mount a volume at /data to persist
# across restarts/redeploys:  docker run -v mehrin-data:/data ...
ENV DATA_FILE=/data/purchases.json
VOLUME /data
EXPOSE 8080

CMD ["node", "dist/server/index.js"]
