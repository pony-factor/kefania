FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY PULL_REQUEST.md ./PULL_REQUEST.md
USER node
ENV PORT=8765
EXPOSE 8765
CMD ["node", "src/hosted.js"]
