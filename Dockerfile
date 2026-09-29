# Local development image shared by the web and API services.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/web/package.json ./frontend/web/package.json
COPY backend/platform/package.json ./backend/platform/package.json
RUN npm ci
COPY . .
CMD ["npm", "run", "dev"]
