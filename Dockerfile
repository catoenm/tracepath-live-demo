FROM node:24-bookworm-slim
WORKDIR /demo
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
USER node
CMD ["node", "src/api.mjs"]
