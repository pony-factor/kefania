FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache github-cli
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY PULL_REQUEST.md ./
EXPOSE 8765
CMD ["npm", "run", "start:http"]
